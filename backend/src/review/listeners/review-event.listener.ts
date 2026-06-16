import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductEntity } from '../../product/entity/product.entity';
import {
  ProductSummaryEntity,
  ProductSummaryStatus,
} from '../../product/entity/product-summary.entity';
import { RedisService } from '../../intrastructure/redis/redis.service';
import { ReviewCreatedEvent, ReviewDeletedEvent } from '../events/review.events';
import { withRetry } from '../../common/utils/with-retry';

@Injectable()
export class ReviewEventListener {
  private readonly logger = new Logger(ReviewEventListener.name);

  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    @InjectRepository(ProductSummaryEntity)
    private readonly summaryRepository: Repository<ProductSummaryEntity>,
    private readonly redisService: RedisService,
  ) {}

  @OnEvent('review.created')
  async handleReviewCreated(event: ReviewCreatedEvent) {
    this.logger.log(
      `리뷰 생성 — reviewId: ${event.reviewId}, productId: ${event.productId}, rating: ${event.rating}`,
    );

    await withRetry(
      async () => {
        await this.productRepository.increment({ id: event.productId }, 'reviewCount', 1);
        await this.productRepository.increment({ id: event.productId }, 'ratingSum', event.rating);
        await this.recalculateRating(event.productId);
      },
      `review.created(productId=${event.productId})`,
    );

    await this.markSummaryStale(event.productId);
  }

  @OnEvent('review.deleted')
  async handleReviewDeleted(event: ReviewDeletedEvent) {
    this.logger.log(
      `리뷰 삭제 — productId: ${event.productId}, rating: ${event.rating}`,
    );

    await withRetry(
      async () => {
        await this.productRepository.decrement({ id: event.productId }, 'reviewCount', 1);
        await this.productRepository.decrement({ id: event.productId }, 'ratingSum', event.rating);
        await this.recalculateRating(event.productId);
      },
      `review.deleted(productId=${event.productId})`,
    );

    await this.markSummaryStale(event.productId);
  }

  /**
   * (Phase 5c) 리뷰 변경 시 AI 요약을 "낡음"으로 표시한다(LLM 호출 0). 다음 상품 상세 열람 때
   * 백그라운드 재생성된다(SWR). 요약 row 가 없는 콜드 상품이면 0행 — getReviewSummary 가
   * 콜드를 stale 과 동일 취급하고 재생성 트리거가 row 를 지연 생성하므로 upsert 가 불필요하다.
   */
  private async markSummaryStale(productId: number) {
    try {
      await this.summaryRepository.update(
        { productId },
        { status: ProductSummaryStatus.STALE },
      );
    } catch (e) {
      // 집계 갱신과 분리된 best-effort — 실패해도 리뷰 처리 흐름을 막지 않는다.
      this.logger.warn(
        `리뷰 요약 stale 표시 실패 productId=${productId}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * 원자적 rating 재계산 — 단일 UPDATE 쿼리로 race condition 방지
   */
  private async recalculateRating(productId: number) {
    await this.productRepository
      .createQueryBuilder()
      .update(ProductEntity)
      .set({
        rating: () =>
          `CASE WHEN "reviewCount" > 0 THEN ROUND("ratingSum"::numeric / "reviewCount", 1) ELSE NULL END`,
      })
      .where('id = :id', { id: productId })
      .execute();

    await this.redisService.delCache(`products:detail:${productId}`);
    await this.redisService.delCacheByPattern('products:list:*');
  }
}
