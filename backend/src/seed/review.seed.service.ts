import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ReviewEntity } from '../review/entity/review.entity';
import { ProductEntity, ProductStatus } from '../product/entity/product.entity';
import { rand } from './seed-helpers';

/** §3-C 에서 시드 주문 order_items 에 끼워 넣을 실제 상품 후보 */
export interface SeedProductRef {
  id: number;
  name: string;
  price: number;
  imageUrl: string | null;
}

// 합성 orderId 시작값 — 실제 orders.id(작은 serial)와 충돌하지 않도록 큰 값에서 시작.
// reviews.orderId 는 FK 없는 단순 컬럼이라 임의 합성값을 넣어도 안전(ex-review-frontend §1).
const SYNTHETIC_ORDER_ID_BASE = 900_000_000;

// 상품당 리뷰 개수 범위 (확정된 결정: 3~8개)
const MIN_REVIEWS_PER_PRODUCT = 3;
const MAX_REVIEWS_PER_PRODUCT = 8;

/**
 * rating 4~5 가중 분포 풀. 배열에서 균등 추출 → 5/4 가 다수, 3 소수, 1~2 희소.
 * (현실적인 쇼핑몰 평점대 재현)
 */
const RATING_POOL = [5, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 2, 1];

// 평점대별 한국어 코멘트 템플릿 풀
const COMMENT_TEMPLATES: Record<'high' | 'mid' | 'low', string[]> = {
  high: [
    '기대 이상이에요. 다음에 또 구매할 생각입니다.',
    '배송도 빠르고 품질도 만족스러워요. 강력 추천합니다.',
    '가격 대비 정말 훌륭합니다. 주변에도 추천했어요.',
    '사진이랑 똑같고 마감도 깔끔해요. 잘 쓰고 있습니다.',
    '재구매 의사 100%입니다. 만족도가 높아요.',
    '포장 꼼꼼하게 와서 기분 좋았어요. 제품도 튼튼합니다.',
    '두 번째 구매인데 역시 믿고 사는 제품이에요.',
    '선물용으로 샀는데 받는 분이 너무 좋아했어요.',
  ],
  mid: [
    '나쁘지 않아요. 가격 생각하면 무난한 선택입니다.',
    '딱 기대한 만큼이에요. 특별하진 않지만 쓸만합니다.',
    '괜찮긴 한데 배송이 조금 늦었어요.',
    '품질은 보통이에요. 무난하게 사용 중입니다.',
    '가성비는 괜찮은데 마감이 조금 아쉬워요.',
  ],
  low: [
    '생각보다 별로였어요. 다시 살 것 같진 않네요.',
    '사진과 실물이 좀 달라서 아쉬웠습니다.',
    '배송도 느리고 품질도 기대 이하였어요.',
    '가격 대비 만족스럽지 못했습니다.',
  ],
};

function pickRating(): number {
  return RATING_POOL[rand(0, RATING_POOL.length - 1)];
}

function pickComment(rating: number): string {
  const tier = rating >= 4 ? 'high' : rating === 3 ? 'mid' : 'low';
  const pool = COMMENT_TEMPLATES[tier];
  return pool[rand(0, pool.length - 1)];
}

/**
 * 커버리지 리뷰 시드 + 시드 주문용 실제 상품 풀 제공.
 *
 * - 커버리지 시드(§3-B): 모든 published 상품에 시드 buyer 분산으로 3~8개 리뷰를 합성 orderId 로 생성.
 *   끝나고 상품 집계(reviewCount/ratingSum/rating)를 전 상품 일괄 재계산(이벤트 미발행 경로).
 * - 실제 상품 풀(§3-C): 시드 주문 order_items 의 product_id=999999 를 실제 상품으로 교체할 때 재사용.
 *
 * NODE_SEED 게이트는 호출부(DashboardSeedService)가 담당. 멱등성은 "상품에 리뷰 있으면 skip".
 */
@Injectable()
export class ReviewSeedService {
  constructor(
    @InjectDataSource()
    private readonly ds: DataSource,
    @InjectRepository(ReviewEntity)
    private readonly reviewRepo: Repository<ReviewEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
  ) {}

  /**
   * §3-C: published 상품을 대표 이미지와 함께 로드해 시드 주문에 끼워 넣을 풀을 만든다.
   * 대표 이미지는 isPrimary 우선, 없으면 첫 이미지.
   */
  async loadPublishedProductPool(): Promise<SeedProductRef[]> {
    const products = await this.productRepo.find({
      where: { status: ProductStatus.PUBLISHED },
      relations: ['images'],
    });

    return products.map((p) => {
      const primary =
        p.images?.find((img) => img.isPrimary) ?? p.images?.[0] ?? null;
      return {
        id: p.id,
        name: p.name,
        price: Number(p.price),
        imageUrl: primary?.url ?? null,
      };
    });
  }

  /**
   * §3-B: 모든 published 상품에 커버리지 리뷰를 생성한다.
   * @param buyerUserIds 시드 buyer userId 목록(리뷰 작성자 풀, userId FK 의존)
   */
  async seedCoverageReviews(buyerUserIds: number[]): Promise<void> {
    if (buyerUserIds.length === 0) {
      console.log('  ⚠️  buyer 유저가 없어 커버리지 리뷰 시드를 건너뜁니다.');
      return;
    }

    const products = await this.productRepo.find({
      where: { status: ProductStatus.PUBLISHED },
      select: ['id'],
    });

    if (products.length === 0) {
      console.log('  ⚠️  published 상품이 없어 커버리지 리뷰 시드를 건너뜁니다.');
      return;
    }

    // 멱등: 이미 리뷰가 있는 상품은 제외(상품에 리뷰 있으면 skip)
    const reviewedRows: { product_id: number }[] = await this.ds.query(
      `SELECT DISTINCT product_id FROM reviews`,
    );
    const reviewedSet = new Set(reviewedRows.map((r) => Number(r.product_id)));
    const targets = products.filter((p) => !reviewedSet.has(p.id));

    if (targets.length === 0) {
      console.log('  ✓ 모든 상품에 이미 리뷰가 있어 커버리지 시드 skip');
      await this.recalculateAllAggregates();
      return;
    }

    // 상품당 최대 리뷰 수는 buyer 수를 넘을 수 없음(상품당 유저 중복 금지)
    const maxPerProduct = Math.min(MAX_REVIEWS_PER_PRODUCT, buyerUserIds.length);

    let synthetic = SYNTHETIC_ORDER_ID_BASE;
    const reviews: ReviewEntity[] = [];

    for (const product of targets) {
      const target = rand(MIN_REVIEWS_PER_PRODUCT, maxPerProduct);
      const authors = this.pickDistinct(buyerUserIds, target);

      for (const userId of authors) {
        const rating = pickRating();
        reviews.push(
          this.reviewRepo.create({
            userId,
            productId: product.id,
            orderId: synthetic++,
            rating,
            comment: pickComment(rating),
            imageUrls: [],
          }),
        );
      }
    }

    // 대량 저장(청크 분할)
    await this.reviewRepo.save(reviews, { chunk: 200 });

    // 이벤트 미발행 경로이므로 상품 집계를 직접 일괄 재계산
    await this.recalculateAllAggregates();

    console.log(
      `  ✓ 커버리지 리뷰 ${reviews.length}건 (상품 ${targets.length}개) + 집계 재계산`,
    );
  }

  /**
   * 전 상품의 reviewCount/ratingSum/rating 을 reviews 테이블에서 일괄 재계산.
   * LEFT JOIN 으로 리뷰 없는 상품도 0/NULL 로 정정 → 멱등·자기교정.
   */
  private async recalculateAllAggregates(): Promise<void> {
    await this.ds.query(`
      UPDATE products p SET
        "reviewCount" = COALESCE(agg.cnt, 0),
        "ratingSum"   = COALESCE(agg.sm, 0),
        rating = CASE WHEN COALESCE(agg.cnt, 0) > 0
                      THEN ROUND(agg.sm::numeric / agg.cnt, 1)
                      ELSE NULL END
      FROM products p2
      LEFT JOIN (
        SELECT product_id, COUNT(*) AS cnt, SUM(rating) AS sm
        FROM reviews GROUP BY product_id
      ) agg ON agg.product_id = p2.id
      WHERE p.id = p2.id
    `);
  }

  /** 배열에서 중복 없이 count 개를 무작위 추출 */
  private pickDistinct<T>(arr: T[], count: number): T[] {
    const pool = [...arr];
    const out: T[] = [];
    const n = Math.min(count, pool.length);
    for (let i = 0; i < n; i++) {
      const idx = rand(0, pool.length - 1);
      out.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return out;
  }
}
