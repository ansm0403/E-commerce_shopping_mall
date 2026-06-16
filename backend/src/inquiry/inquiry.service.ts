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
import { InquiryEntity, InquiryStatus } from './entity/inquiry.entity';
import { scrubText } from '../common/utils/scrub-text';
import { ProductEntity } from '../product/entity/product.entity';
import { SellerEntity } from '../seller/entity/seller.entity';
import { CreateInquiryDto } from './dto/create-inquiry.dto';
import { AnswerInquiryDto } from './dto/answer-inquiry.dto';
import { BasePaginateDto } from '../common/dto/paginate.dto';
import { CommonService } from '../common/common.service';

@Injectable()
export class InquiryService {
  constructor(
    @InjectRepository(InquiryEntity)
    private readonly inquiryRepository: Repository<InquiryEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    @InjectRepository(SellerEntity)
    private readonly sellerRepository: Repository<SellerEntity>,
    private readonly commonService: CommonService,
  ) {}

  // ── Buyer ──

  async create(userId: number, dto: CreateInquiryDto) {
    const product = await this.productRepository.findOne({
      where: { id: dto.productId },
    });

    if (!product) {
      throw new NotFoundException('상품을 찾을 수 없습니다.');
    }

    if (!product.sellerId) {
      throw new BadRequestException('셀러 정보가 없는 상품입니다.');
    }

    const inquiry = this.inquiryRepository.create({
      userId,
      productId: dto.productId,
      sellerId: product.sellerId,
      title: dto.title,
      content: dto.content,
      isSecret: dto.isSecret ?? false,
    });

    const saved = await this.inquiryRepository.save(inquiry);
    return this.findOneWithUser(saved.id);
  }

  async getByProduct(productId: number, userId: number | null, query: BasePaginateDto) {
    const result = await this.commonService.paginate(query, this.inquiryRepository, 'inquiries', {
      where: { productId },
      relations: ['user'],
    });

    // 비밀 문의: 본인 것만 content/answer 노출, 나머지는 마스킹
    result.data = result.data.map((inquiry) => {
      if (inquiry.isSecret && inquiry.userId !== userId) {
        return {
          ...inquiry,
          title: '비밀 문의입니다.',
          content: '',
          answer: null,
          // 탈퇴 유저의 문의는 user relation이 null일 수 있으므로 optional chaining 처리
          user: inquiry.user ? { id: inquiry.user.id, nickName: '***' } : null,
        };
      }
      return inquiry;
    }) as unknown as typeof result.data;

    return result;
  }

  async getMyInquiries(userId: number, query: BasePaginateDto) {
    return this.commonService.paginate(query, this.inquiryRepository, 'inquiries/my', {
      where: { userId },
      relations: ['user'],
    });
  }

  async delete(userId: number, inquiryId: number) {
    const inquiry = await this.inquiryRepository.findOne({
      where: { id: inquiryId },
    });

    if (!inquiry) {
      throw new NotFoundException('문의를 찾을 수 없습니다.');
    }

    if (inquiry.userId !== userId) {
      throw new ForbiddenException('본인의 문의만 삭제할 수 있습니다.');
    }

    if (inquiry.status === InquiryStatus.ANSWERED) {
      throw new BadRequestException('답변이 완료된 문의는 삭제할 수 없습니다.');
    }

    await this.inquiryRepository.remove(inquiry);
    return { message: '문의가 삭제되었습니다.' };
  }

  // ── Seller ──

  async getSellerInquiries(userId: number, query: BasePaginateDto) {
    const seller = await this.sellerRepository.findOne({ where: { userId } });
    if (!seller) {
      throw new NotFoundException('셀러 정보를 찾을 수 없습니다.');
    }

    return this.commonService.paginate(query, this.inquiryRepository, 'seller/inquiries', {
      where: { sellerId: seller.id },
      relations: ['user'],
    });
  }

  async answer(userId: number, inquiryId: number, dto: AnswerInquiryDto) {
    const seller = await this.sellerRepository.findOne({ where: { userId } });
    if (!seller) {
      throw new NotFoundException('셀러 정보를 찾을 수 없습니다.');
    }

    const inquiry = await this.inquiryRepository.findOne({
      where: { id: inquiryId },
    });

    if (!inquiry) {
      throw new NotFoundException('문의를 찾을 수 없습니다.');
    }

    if (inquiry.sellerId !== seller.id) {
      throw new ForbiddenException('본인 상품에 대한 문의만 답변할 수 있습니다.');
    }

    if (inquiry.status === InquiryStatus.ANSWERED) {
      throw new BadRequestException('이미 답변이 완료된 문의입니다.');
    }

    inquiry.answer = dto.answer;
    inquiry.answeredAt = new Date();
    inquiry.status = InquiryStatus.ANSWERED;
    await this.inquiryRepository.save(inquiry);

    return this.findOneWithUser(inquiry.id);
  }

  private async findOneWithUser(inquiryId: number) {
    return this.inquiryRepository.findOne({
      where: { id: inquiryId },
      relations: ['user'],
    });
  }

  // ── AI 어시스턴트(Phase 5a 단순 RAG) ──

  /**
   * 어시스턴트 전용 읽기 메서드 — 조건에 맞는 문의 텍스트를 모아 LLM 요약에 넘긴다.
   *
   * - 카테고리는 모른다: 디스패처가 categoryName→productIds 변환 후 넘긴다.
   *   productIds 가 undefined 면 전체, 빈 배열이면 "필터 결과 0건"으로 구분한다.
   * - status(waiting/answered)·기간(createdAt)으로 좁힐 수 있다(미답변=waiting).
   * - ⚠ user/seller 관계는 반환하지 않는다(작성자/셀러 신원 미노출). 본문은 scrubText 로 PII 제거.
   * - (D1) 비밀 문의(isSecret=true)는 제목/본문/답변을 제외하고 메타(상태·상품·작성일)만 반환한다.
   */
  async getInquiriesForAssistant(params: {
    productIds?: number[];
    status?: string;
    startDate?: string;
    endDate?: string;
    take?: number;
  }): Promise<
    {
      status: InquiryStatus;
      title: string | null;
      content: string | null;
      answer: string | null;
      productId: number;
      isSecret: boolean;
      createdAt: Date;
    }[]
  > {
    const where: FindOptionsWhere<InquiryEntity> = {};
    if (params.productIds !== undefined) where.productId = In(params.productIds);
    const status = this.normalizeStatus(params.status);
    if (status) where.status = status;
    const dateFilter = this.buildDateFilter(params.startDate, params.endDate);
    if (dateFilter) where.createdAt = dateFilter;

    const rows = await this.inquiryRepository.find({
      where,
      order: { createdAt: 'DESC' },
      // 상한 50 + 하한 1 — 모델이 음수 take 를 보내면 'LIMIT must not be negative' 로 크래시한다.
      take: Math.max(1, Math.min(params.take ?? 30, 50)),
    });

    return rows.map((r) =>
      r.isSecret
        ? {
            status: r.status,
            title: null,
            content: null,
            answer: null,
            productId: r.productId,
            isSecret: true,
            createdAt: r.createdAt,
          }
        : {
            status: r.status,
            title: scrubText(r.title),
            content: scrubText(r.content),
            answer: scrubText(r.answer),
            productId: r.productId,
            isSecret: false,
            createdAt: r.createdAt,
          },
    );
  }

  /** 모델이 준 status 문자열을 InquiryStatus enum 으로(유효하지 않으면 미적용). */
  private normalizeStatus(status?: string): InquiryStatus | undefined {
    if (!status) return undefined;
    const v = status.toLowerCase();
    if (v === InquiryStatus.WAITING) return InquiryStatus.WAITING;
    if (v === InquiryStatus.ANSWERED) return InquiryStatus.ANSWERED;
    return undefined;
  }

  /** createdAt 기간 필터 빌더. (ISO 문자열 입력, KST 정규화는 디스패처 담당) */
  private buildDateFilter(start?: string, end?: string) {
    if (start && end) return Between(new Date(start), new Date(end));
    if (start) return MoreThanOrEqual(new Date(start));
    if (end) return LessThanOrEqual(new Date(end));
    return undefined;
  }
}
