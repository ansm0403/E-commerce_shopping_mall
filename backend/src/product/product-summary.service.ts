import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ProductEntity } from './entity/product.entity';
import {
  ProductSummaryEntity,
  ProductSummaryStatus,
} from './entity/product-summary.entity';
import { ReviewService } from '../review/review.service';
import { LLM_CLIENT } from '../intrastructure/ai/ai.constants';
import type { LlmClient } from '../intrastructure/ai/llm-client.interface';
import { ProductReviewAiSummaryDto } from './dto/review-summary-response.dto';

/**
 * 구매자 상품 상세의 AI 리뷰 요약 — 이벤트 기반 무효화 + SWR(stale-while-revalidate). (Phase 5c)
 *
 * - 읽기(getReviewSummary): 캐시를 즉시 반환하고, 낡았으면 **백그라운드**에서 재생성을 트리거한다.
 *   상품 페이지는 LLM 을 절대 동기 대기하지 않는다(읽기 경로 LLM 호출 0).
 * - 쓰기: 리뷰 생성/삭제 이벤트가 status='stale' 로만 표시(ReviewEventListener, LLM 0회).
 * - 비용 가드(무료티어): 상품당 재생성 최소 간격(throttle) + 동시 1건 CAS 락. 스턱 락은 LOCK_TTL 만료 시 회수.
 * - PII: getReviewsForAssistant 경유라 user 미반환 + comment 스크럽됨(§8-4 재확인). LLM 키 없으면 no-op.
 */
@Injectable()
export class ProductSummaryService {
  private readonly logger = new Logger(ProductSummaryService.name);

  private static readonly MIN_REVIEWS = 3;
  private static readonly THROTTLE_MS = 10 * 60 * 1000; // 재생성 최소 간격 10분
  private static readonly LOCK_TTL_MS = 2 * 60 * 1000; // 스턱 락 만료 2분
  private static readonly TAKE = 30;
  /** 프롬프트/모델 변경 시 +1 → read 경로에서 자동 stale(P4). */
  private static readonly PROMPT_VERSION = 1;

  private static readonly SUMMARY_SYSTEM =
    '너는 쇼핑몰 상품의 고객 리뷰를 요약하는 어시스턴트다. ' +
    '주어진 리뷰 데이터만 근거로, 과장 없이 한국어로 3~4줄로 요약하라. ' +
    '장점, 단점, 총평 순서로 핵심만 담되, 개별 작성자·연락처·외부 정보는 절대 언급하지 마라. ' +
    '데이터에 없는 내용은 지어내지 마라.';

  constructor(
    @InjectRepository(ProductSummaryEntity)
    private readonly summaryRepository: Repository<ProductSummaryEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    private readonly reviewService: ReviewService,
    @Inject(LLM_CLIENT)
    private readonly llm: LlmClient,
    private readonly config: ConfigService,
  ) {}

  /**
   * 읽기(SWR). 캐시를 즉시 반환하고, 낡았으면 백그라운드 재생성을 트리거한다(await 안 함).
   */
  async getReviewSummary(
    productId: number,
  ): Promise<ProductReviewAiSummaryDto> {
    const product = await this.productRepository.findOne({
      where: { id: productId },
      select: ['id', 'reviewCount'],
    });
    const reviewCount = product?.reviewCount ?? 0;
    if (reviewCount < ProductSummaryService.MIN_REVIEWS) {
      return { available: false };
    }

    const row = await this.summaryRepository.findOne({ where: { productId } });

    // fresh + 현재 프롬프트 버전이면 그대로 반환(트리거 없음).
    if (
      row &&
      row.status === ProductSummaryStatus.FRESH &&
      row.promptVersion === ProductSummaryService.PROMPT_VERSION
    ) {
      return {
        available: true,
        status: ProductSummaryStatus.FRESH,
        summary: row.summaryText,
        reviewCount,
        generatedAt: row.generatedAt,
      };
    }

    // 낡음(stale/콜드/프롬프트버전 불일치) → 기존 text 즉시 반환 + 백그라운드 재생성 트리거.
    const acquired = await this.tryAcquireAndRegenerate(productId, row);
    return {
      available: true,
      status: acquired
        ? ProductSummaryStatus.GENERATING
        : (row?.status ?? ProductSummaryStatus.STALE),
      summary: row?.summaryText ?? null,
      reviewCount,
      generatedAt: row?.generatedAt ?? null,
    };
  }

  /**
   * 비용 가드를 통과하면 CAS 로 동시 1건만 락을 선점하고 백그라운드 재생성을 fire-and-forget 한다.
   * @returns 락을 선점해 재생성을 시작했으면 true.
   */
  private async tryAcquireAndRegenerate(
    productId: number,
    row: ProductSummaryEntity | null,
  ): Promise<boolean> {
    const now = Date.now();
    const lockExpiry = new Date(now - ProductSummaryService.LOCK_TTL_MS);
    const throttleCutoff = new Date(now - ProductSummaryService.THROTTLE_MS);

    if (!row) {
      // 콜드: INSERT-as-CAS. unique(productId) 가 동시 콜드 요청 중 1건만 통과시킨다.
      try {
        await this.summaryRepository.insert({
          productId,
          status: ProductSummaryStatus.GENERATING,
          lockedAt: new Date(now),
        });
      } catch (e) {
        if (e instanceof QueryFailedError) return false; // 다른 요청이 이미 선점
        throw e;
      }
      void this.regenerate(productId);
      return true;
    }

    // 기존 row: CAS UPDATE — (락 미점유 or 스턱) AND (throttle 경과 or 콜드) 일 때만 1건 선점.
    const res = await this.summaryRepository
      .createQueryBuilder()
      .update(ProductSummaryEntity)
      .set({ status: ProductSummaryStatus.GENERATING, lockedAt: new Date(now) })
      .where('productId = :productId', { productId })
      .andWhere('(status != :generating OR lockedAt < :lockExpiry)', {
        generating: ProductSummaryStatus.GENERATING,
        lockExpiry,
      })
      .andWhere('(generatedAt IS NULL OR generatedAt < :throttleCutoff)', {
        throttleCutoff,
      })
      .execute();

    if (res.affected && res.affected > 0) {
      void this.regenerate(productId);
      return true;
    }
    return false;
  }

  /**
   * 백그라운드 재생성(fire-and-forget). 예외가 절대 밖으로 새지 않게 전체를 감싼다.
   * 성공: status='fresh' + 메타 갱신. 실패/비활성: status='stale' 롤백(lockedAt=null).
   */
  private async regenerate(productId: number): Promise<void> {
    try {
      if (!this.llm.isEnabled()) {
        await this.rollbackStale(productId);
        return;
      }

      const reviews = await this.reviewService.getReviewsForAssistant({
        productIds: [productId],
        take: ProductSummaryService.TAKE,
      });
      if (reviews.length < ProductSummaryService.MIN_REVIEWS) {
        // 집계(products.reviewCount)와 실제 리뷰 수가 어긋난 경우(desync)의 안전망.
        // throttle 을 걸어 매 방문마다 헛 재생성(DB 조회 + CAS 왕복)이 반복되지 않게 한다.
        await this.rollbackStale(productId, true);
        return;
      }

      const text = (
        await this.llm.generate({
          system: ProductSummaryService.SUMMARY_SYSTEM,
          messages: [{ role: 'user', content: this.buildPrompt(reviews) }],
        })
      ).trim();

      // 빈/공백 응답(안전필터 차단 등)을 fresh 로 캐시하면 빈 요약이 영구 고정된다(재생성 안 됨).
      // → 실패로 간주해 stale 로 되돌리되 throttle 을 걸어 같은 프롬프트로 LLM 을 난타하지 않는다.
      if (!text) {
        this.logger.warn(`리뷰 요약 재생성 — 빈 응답 productId=${productId}`);
        await this.rollbackStale(productId, true);
        return;
      }

      await this.summaryRepository.update(
        { productId },
        {
          summaryText: text,
          status: ProductSummaryStatus.FRESH,
          reviewCountAtGen: reviews.length,
          model: this.config.get<string>('GEMINI_MODEL') ?? null,
          promptVersion: ProductSummaryService.PROMPT_VERSION,
          generatedAt: new Date(),
          lockedAt: null,
        },
      );
    } catch (e) {
      this.logger.warn(
        `리뷰 요약 재생성 실패 productId=${productId}: ${(e as Error).message}`,
      );
      // 일시 오류(LLM throw/타임아웃 등) → throttle 없이 다음 방문에 재시도.
      await this.rollbackStale(productId);
    }
  }

  /**
   * 실패/비활성 시 락 해제 + stale 복귀.
   * - throttle=false(기본): generatedAt 미변경 → 일시 오류는 다음 방문에 곧바로 재시도(콜드면 null 유지).
   * - throttle=true: generatedAt=now() → 비-일시 실패(빈 응답·리뷰수 desync)에서 헛 재생성/LLM 난타 방지.
   */
  private async rollbackStale(productId: number, throttle = false): Promise<void> {
    try {
      await this.summaryRepository.update(
        { productId },
        {
          status: ProductSummaryStatus.STALE,
          lockedAt: null,
          ...(throttle ? { generatedAt: new Date() } : {}),
        },
      );
    } catch {
      // 롤백 실패는 무시(LOCK_TTL 만료로 자가 회수됨).
    }
  }

  /** 평점 분포 + 스크럽된 리뷰 본문을 RAG 프롬프트로 직렬화. */
  private buildPrompt(
    reviews: { rating: number; comment: string | null; createdAt: Date }[],
  ): string {
    const dist: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const r of reviews) {
      if (r.rating >= 1 && r.rating <= 5) dist[r.rating] += 1;
    }
    const distLine = [5, 4, 3, 2, 1]
      .map((s) => `★${s}: ${dist[s]}건`)
      .join(', ');

    const lines = reviews
      .map((r) => `[★${r.rating}] ${(r.comment ?? '').trim()}`)
      .filter((l) => l.length > 0)
      .join('\n');

    return [
      `다음은 한 상품의 최근 고객 리뷰 ${reviews.length}건이다.`,
      `평점 분포: ${distLine}`,
      '',
      '리뷰 목록:',
      lines,
      '',
      '위 리뷰만 근거로 장점/단점/총평을 한국어 3~4줄로 요약하라.',
    ].join('\n');
  }
}
