import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ReviewEntity } from './entity/review.entity';
import { scrubText } from '../common/utils/scrub-text';
import { OrderEntity, OrderStatus } from '../order/entity/order.entity';
import { OrderItemEntity } from '../order/entity/order-item.entity';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewCreatedEvent, ReviewDeletedEvent } from './events/review.events';
import { ReviewSummaryResponseDto } from './dto/review-summary-response.dto';
import { BasePaginateDto } from '../common/dto/paginate.dto';
import { CommonService } from '../common/common.service';

@Injectable()
export class ReviewService {
  constructor(
    @InjectRepository(ReviewEntity)
    private readonly reviewRepository: Repository<ReviewEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(OrderItemEntity)
    private readonly orderItemRepository: Repository<OrderItemEntity>,
    private readonly eventEmitter: EventEmitter2,
    private readonly commonService: CommonService,
  ) {}

  async create(userId: number, dto: CreateReviewDto) {
    // 1. 주문 검증: COMPLETED 상태인지
    const order = await this.orderRepository.findOne({
      where: { id: dto.orderId, userId },
    });

    if (!order) {
      throw new NotFoundException('주문을 찾을 수 없습니다.');
    }

    if (order.status !== OrderStatus.COMPLETED) {
      throw new BadRequestException('구매 확정된 주문에 대해서만 리뷰를 작성할 수 있습니다.');
    }

    // 2. 해당 주문에 해당 상품이 포함되어 있는지 검증
    const orderItem = await this.orderItemRepository.findOne({
      where: { orderId: dto.orderId, productId: dto.productId },
    });

    if (!orderItem) {
      throw new BadRequestException('해당 주문에 포함되지 않은 상품입니다.');
    }

    // 3. 중복 리뷰 방지
    const existing = await this.reviewRepository.findOne({
      where: { userId, productId: dto.productId, orderId: dto.orderId },
    });

    if (existing) {
      throw new BadRequestException('이미 해당 주문에 대한 리뷰를 작성하셨습니다.');
    }

    // 4. 리뷰 생성
    const review = this.reviewRepository.create({
      userId,
      productId: dto.productId,
      orderId: dto.orderId,
      rating: dto.rating,
      comment: dto.comment,
      imageUrls: dto.imageUrls ?? [],
    });

    const saved = await this.reviewRepository.save(review);

    this.eventEmitter.emit(
      'review.created',
      new ReviewCreatedEvent(saved.id, saved.productId, saved.rating),
    );

    return this.findOneWithUser(saved.id);
  }

  async update(userId: number, reviewId: number, dto: UpdateReviewDto) {
    const review = await this.reviewRepository.findOne({
      where: { id: reviewId },
    });

    if (!review) {
      throw new NotFoundException('리뷰를 찾을 수 없습니다.');
    }

    if (review.userId !== userId) {
      throw new ForbiddenException('본인의 리뷰만 수정할 수 있습니다.');
    }

    // 30일 수정 제한
    const daysSinceCreation =
      (Date.now() - review.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCreation > 30) {
      throw new BadRequestException('리뷰 작성 후 30일이 지나 수정할 수 없습니다.');
    }

    const oldRating = review.rating;

    if (dto.rating !== undefined) review.rating = dto.rating;
    if (dto.comment !== undefined) review.comment = dto.comment;
    if (dto.imageUrls !== undefined) review.imageUrls = dto.imageUrls;

    await this.reviewRepository.save(review);

    // rating이 변경된 경우 이벤트 발행 (삭제 후 생성으로 처리)
    if (dto.rating !== undefined && dto.rating !== oldRating) {
      this.eventEmitter.emit(
        'review.deleted',
        new ReviewDeletedEvent(review.productId, oldRating),
      );
      this.eventEmitter.emit(
        'review.created',
        new ReviewCreatedEvent(review.id, review.productId, dto.rating),
      );
    }

    return this.findOneWithUser(review.id);
  }

  async delete(userId: number, reviewId: number, isAdmin: boolean) {
    const review = await this.reviewRepository.findOne({
      where: { id: reviewId },
    });

    if (!review) {
      throw new NotFoundException('리뷰를 찾을 수 없습니다.');
    }

    if (!isAdmin && review.userId !== userId) {
      throw new ForbiddenException('본인의 리뷰만 삭제할 수 있습니다.');
    }

    await this.reviewRepository.remove(review);

    this.eventEmitter.emit(
      'review.deleted',
      new ReviewDeletedEvent(review.productId, review.rating),
    );

    return { message: '리뷰가 삭제되었습니다.' };
  }

  async getByProduct(productId: number, query: BasePaginateDto) {
    return this.commonService.paginate(query, this.reviewRepository, 'reviews', {
      where: { productId },
      relations: ['user'],
    });
  }

  async getMyReviews(userId: number, query: BasePaginateDto) {
    return this.commonService.paginate(query, this.reviewRepository, 'reviews/my', {
      where: { userId },
      relations: ['user'],
    });
  }

  /**
   * 상품 평점 분포 집계 (별점별 개수 + 평균 + 총개수).
   * GROUP BY rating 단일 쿼리로 집계해 상품 상세의 분포 막대를 실데이터로 채운다.
   */
  async getProductReviewSummary(
    productId: number,
  ): Promise<ReviewSummaryResponseDto> {
    const rows = await this.reviewRepository
      .createQueryBuilder('review')
      .select('review.rating', 'rating')
      .addSelect('COUNT(*)', 'count')
      .where('review.productId = :productId', { productId })
      .groupBy('review.rating')
      .getRawMany<{ rating: number; count: string }>();

    const distribution: Record<1 | 2 | 3 | 4 | 5, number> = {
      5: 0,
      4: 0,
      3: 0,
      2: 0,
      1: 0,
    };
    let count = 0;
    let sum = 0;

    for (const row of rows) {
      const rating = Number(row.rating);
      const c = Number(row.count);
      if (rating >= 1 && rating <= 5) {
        distribution[rating as 1 | 2 | 3 | 4 | 5] = c;
      }
      count += c;
      sum += rating * c;
    }

    const average = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;

    return { average, count, distribution };
  }

  private async findOneWithUser(reviewId: number) {
    return this.reviewRepository.findOne({
      where: { id: reviewId },
      relations: ['user'],
    });
  }

  // ── AI 어시스턴트(Phase 5a 단순 RAG) ──

  /**
   * 어시스턴트 전용 읽기 메서드 — 조건에 맞는 리뷰 텍스트를 모아 LLM 요약에 넘긴다.
   *
   * - 카테고리는 모른다: 디스패처(AssistantService)가 categoryName→productIds 변환 후 넘긴다.
   * - productIds 가 undefined 면 전체, 빈 배열이면 "필터 결과 0건"(In([])=무매칭)으로 구분한다.
   * - maxRating 으로 부정 리뷰(≤2)만 추리고, 기간(createdAt)으로 좁힐 수 있다.
   * - ⚠ user 관계는 반환하지 않는다(작성자 신원 미노출). comment 는 scrubText 로
   *   이메일·전화 PII 를 제거한다 — 도구 결과는 직렬화 인터셉터를 안 타 @Exclude 가 무력하므로
   *   안전 필드만 명시 projection + 텍스트 스크럽으로 직접 가공한다(§8-4).
   */
  async getReviewsForAssistant(params: {
    productIds?: number[];
    maxRating?: number;
    startDate?: string;
    endDate?: string;
    take?: number;
  }): Promise<
    {
      rating: number;
      comment: string | null;
      productId: number;
      createdAt: Date;
    }[]
  > {
    const where: FindOptionsWhere<ReviewEntity> = {};
    if (params.productIds !== undefined) where.productId = In(params.productIds);
    if (params.maxRating != null)
      where.rating = LessThanOrEqual(params.maxRating);
    const dateFilter = this.buildDateFilter(params.startDate, params.endDate);
    if (dateFilter) where.createdAt = dateFilter;

    const rows = await this.reviewRepository.find({
      where,
      order: { createdAt: 'DESC' },
      // 상한 50 + 하한 1 — 모델이 음수 take 를 보내면 'LIMIT must not be negative' 로 크래시한다.
      take: Math.max(1, Math.min(params.take ?? 30, 50)),
    });

    return rows.map((r) => ({
      rating: r.rating,
      comment: scrubText(r.comment),
      productId: r.productId,
      createdAt: r.createdAt,
    }));
  }

  /** createdAt 기간 필터 빌더 — 양끝/한쪽만 있을 때 모두 처리. (ISO 문자열 입력, KST 정규화는 디스패처 담당) */
  private buildDateFilter(start?: string, end?: string) {
    if (start && end) return Between(new Date(start), new Date(end));
    if (start) return MoreThanOrEqual(new Date(start));
    if (end) return LessThanOrEqual(new Date(end));
    return undefined;
  }
}
