import { Column, Entity, Index, JoinColumn, OneToOne } from 'typeorm';
import { BaseModel } from '../../common/entity/base.entity';
import { ProductEntity } from './product.entity';

/** 요약 캐시의 신선도 상태. (Phase 5c — 이벤트 기반 무효화 + SWR) */
export enum ProductSummaryStatus {
  FRESH = 'fresh', // 최신 — 즉시 반환, 재생성 트리거 없음
  STALE = 'stale', // 낡음/콜드 — 기존 text 즉시 반환 + 백그라운드 재생성 트리거 대상
  GENERATING = 'generating', // 재생성 진행 중(CAS 락 선점됨)
}

/**
 * 구매자 상품 상세에 노출되는 AI 리뷰 요약 캐시. (Phase 5c)
 *
 * - 매 열람마다 LLM 을 부르지 않고 이 테이블에 캐시한다. 리뷰 변경 시 status='stale' 로만
 *   표시(LLM 0회)하고, 다음 열람 때 백그라운드에서 재생성한다(SWR). 읽는 사람은 절대 동기 대기하지 않는다.
 * - ⚠ ProductEntity 에 컬럼을 더하지 않고 별도 테이블로 분리 — 상품 핵심 row·목록 캐시(핫 경로)를
 *   요약 쓰기로 건드리지 않기 위함. 스키마는 synchronize 자동 반영(운영은 수동 DDL 필요).
 * - reviewCountAtGen/promptVersion 은 default 를 둬 콜드 INSERT(productId+status 만)로도 행을
 *   만들 수 있게 한다 — 재생성 트리거의 INSERT-as-CAS(동시 1건 선점)에 필요.
 */
@Entity('product_summaries')
export class ProductSummaryEntity extends BaseModel {
  @Index({ unique: true })
  @Column()
  productId: number;

  /** FK 무결성용. 절대 eager-load 하지 않는다(요약 읽기는 productId 컬럼만 사용). */
  @OneToOne(() => ProductEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId' })
  product?: ProductEntity;

  @Column({ type: 'text', nullable: true })
  summaryText: string | null;

  @Column({
    type: 'enum',
    enum: ProductSummaryStatus,
    default: ProductSummaryStatus.STALE,
  })
  status: ProductSummaryStatus;

  /** 마지막 재생성 시점의 리뷰 수(관측/디버그용). */
  @Column({ type: 'int', default: 0 })
  reviewCountAtGen: number;

  /** 생성에 쓰인 모델 라벨(관측용). 무효화는 promptVersion 비교로 한다(P4). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string | null;

  /** 프롬프트/모델 버전. 코드의 현재 버전과 다르면 read 경로에서 자동 stale 처리(P4). */
  @Column({ type: 'int', default: 0 })
  promptVersion: number;

  @Column({ type: 'timestamptz', nullable: true })
  generatedAt: Date | null;

  /** 재생성 락 시각. LOCK_TTL 경과 시 스턱 락으로 보고 재트리거 허용. */
  @Column({ type: 'timestamptz', nullable: true })
  lockedAt: Date | null;
}
