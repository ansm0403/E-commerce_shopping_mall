import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UserModel } from '../user/entity/user.entity';
import { Role, RoleEntity } from '../user/entity/role.entity';
import { SellerEntity, SellerStatus } from '../seller/entity/seller.entity';
import { OrderStatus } from '../order/entity/order.entity';
import { AuditAction } from '../audit/entity/audit-log.entity';
import {
  rand,
  randomKstTime,
  addMinutes,
  addHours,
  addDays,
} from './seed-helpers';
import { ReviewSeedService, SeedProductRef } from './review.seed.service';
import { InquirySeedService } from './inquiry.seed.service';

// ─── 상수 ────────────────────────────────────────────────────────────────────

const SEED_USER_COUNT = 20;
const SEED_SELLER_COUNT = 5;
const SEED_PASSWORD = 'Seed1234!';
const SEED_MEMO_PREFIX = '[SEED]';
const SEED_METADATA = { seed: 'v1' };

/** 보안 차트 markLine(10%) 초과 검증용 spike 일자 (오늘로부터 N일 전) */
const SPIKE_DAYS = new Set([10, 20]);

const PRODUCT_NAMES = ['시드상품A', '시드상품B', '시드상품C', '시드상품D', '시드상품E'];
const PRODUCT_PRICES = [9_900, 19_900, 29_900, 49_900, 89_900];

// ─── 서비스 ───────────────────────────────────────────────────────────────────

@Injectable()
export class DashboardSeedService implements OnApplicationBootstrap {
  constructor(
    @InjectDataSource()
    private readonly ds: DataSource,
    @InjectRepository(UserModel)
    private readonly userRepo: Repository<UserModel>,
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(SellerEntity)
    private readonly sellerRepo: Repository<SellerEntity>,
    private readonly reviewSeedService: ReviewSeedService,
    private readonly inquirySeedService: InquirySeedService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env['NODE_SEED'] !== 'true') return;

    const days = parseInt(process.env['SEED_DAYS'] ?? '30', 10);
    const reset = process.env['SEED_RESET'] === 'true';

    console.log(`\n🌱  Dashboard Seed 시작 (days=${days}, reset=${reset})\n`);

    try {
      if (reset) {
        await this.resetSeedData();
      }

      // 데모 관리자 계정은 reset/alreadySeeded 체크와 독립적으로 항상 실행 (멱등)
      await this.seedDemoAdmin();

      const alreadySeeded = await this.isSeedDataPresent();
      if (alreadySeeded) {
        console.log('⚠️   이미 시드 데이터가 있습니다.');
        console.log('    재실행하려면 SEED_RESET=true 를 추가하세요.\n');
        process.exit(0);
        return;
      }

      const { userIds, sellerIds } = await this.seedUsers();

      // §3-C: 시드 주문 order_items 에 끼워 넣을 실제 published 상품 풀(999999 대체)
      const productPool = await this.reviewSeedService.loadPublishedProductPool();
      if (productPool.length === 0) {
        console.log(
          '  ⚠️  published 상품이 없어 주문 상품을 합성값(999999)으로 둡니다. ' +
            'POST /v1/products/seed 로 상품을 먼저 시드하세요.',
        );
      }

      await this.seedOrdersAndEvents(userIds, sellerIds, days, productPool);
      await this.seedLoginAudit(userIds, days);
      await this.seedAdminAndSystemAudit(userIds, sellerIds, days);

      // §3-B: 전 published 상품 커버리지 리뷰 + 상품 집계 재계산(buyer 시드 뒤)
      await this.reviewSeedService.seedCoverageReviews(userIds);

      // Phase 5a 어시스턴트 summarize_inquiries 시연용 소규모 문의(미답변/답변/비밀 혼합)
      await this.inquirySeedService.seedInquiries(userIds, sellerIds);

      console.log('\n✅  Seed 완료! 아래 URL에서 차트를 확인하세요:');
      console.log('    http://localhost:3000/admin/dashboard\n');
    } catch (err) {
      console.error('❌  Seed 실패:', err);
      process.exit(1);
    }

    process.exit(0);
  }

  // ─── 데모 관리자 계정 ──────────────────────────────────────────────────────────

  /**
   * 포트폴리오 시연용 공용 관리자 계정 생성.
   *
   * - DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD 환경변수가 없으면 조용히 스킵.
   * - 이미 존재하면 재생성 없이 스킵(멱등).
   * - isDemo: true — DemoAccountGuard 가 위험 작업을 차단하는 데 사용.
   * - email 이 '@seed.com' 도메인이 아니라 resetSeedData 로 삭제되지 않음(의도된 동작).
   */
  private async seedDemoAdmin(): Promise<void> {
    const email = process.env['DEMO_ADMIN_EMAIL'];
    const password = process.env['DEMO_ADMIN_PASSWORD'];

    if (!email || !password) {
      console.log('  ⚠️  DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD 미설정 — 데모 관리자 스킵');
      return;
    }

    const exists = await this.userRepo.findOne({ where: { email } });
    if (exists) {
      console.log(`  ✓ 데모 관리자 이미 존재: ${email}`);
      return;
    }

    const adminRole = await this.roleRepo.findOne({ where: { name: Role.ADMIN } });
    if (!adminRole) {
      console.warn('  ⚠️  admin role 이 없습니다. RolesSeedService 가 먼저 실행되어야 합니다.');
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await this.userRepo.save(
      this.userRepo.create({
        email,
        password: passwordHash,
        nickName: '데모 관리자',
        phoneNumber: '010-0000-0000',
        address: '포트폴리오 시연용 계정',
        isEmailVerified: true,
        isDemo: true,
        roles: [adminRole],
      }),
    );

    console.log(`  ✓ 데모 관리자 생성 완료: ${email}`);
  }

  // ─── 사용자 / 셀러 ─────────────────────────────────────────────────────────

  private async seedUsers(): Promise<{ userIds: number[]; sellerIds: number[] }> {
    const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

    const buyerRole = await this.roleRepo.findOne({ where: { name: Role.BUYER } });
    const sellerRole = await this.roleRepo.findOne({ where: { name: Role.SELLER } });

    if (!buyerRole || !sellerRole) {
      throw new Error(
        'roles 테이블이 비어있습니다. ' +
          '서버를 한 번 정상 실행하여 RolesSeedService 를 먼저 돌린 뒤 재시도하세요.',
      );
    }

    const userIds: number[] = [];

    for (let i = 1; i <= SEED_USER_COUNT; i++) {
      const email = `user${i}@seed.com`;
      let user = await this.userRepo.findOne({ where: { email } });
      if (!user) {
        user = await this.userRepo.save(
          this.userRepo.create({
            email,
            password: passwordHash,
            nickName: `시드유저${i}`,
            phoneNumber: `010-${String(i).padStart(4, '0')}-0000`,
            address: `서울시 강남구 시드로 ${i}길`,
            isEmailVerified: true,
            roles: [buyerRole],
          }),
        );
      }
      userIds.push(user.id);
    }

    const sellerIds: number[] = [];

    for (let i = 1; i <= SEED_SELLER_COUNT; i++) {
      const email = `seller${i}@seed.com`;
      let user = await this.userRepo.findOne({ where: { email } });
      if (!user) {
        user = await this.userRepo.save(
          this.userRepo.create({
            email,
            password: passwordHash,
            nickName: `시드셀러${i}`,
            phoneNumber: `010-900${i}-0000`,
            address: `서울시 마포구 셀러로 ${i}길`,
            isEmailVerified: true,
            roles: [sellerRole],
          }),
        );
      }

      let seller = await this.sellerRepo.findOne({ where: { userId: user.id } });
      if (!seller) {
        seller = await this.sellerRepo.save(
          this.sellerRepo.create({
            userId: user.id,
            businessName: `시드셀러 ${i}호점`,
            businessNumber: `123-45-${String(i).padStart(5, '0')}`,
            representativeName: `대표${i}`,
            businessAddress: `서울시 마포구 사업자로 ${i}`,
            contactEmail: email,
            contactPhone: `02-${i}000-0000`,
            bankName: '국민은행',
            bankAccountNumber: `12345678${i}`,
            bankAccountHolder: `대표${i}`,
            status: SellerStatus.APPROVED,
            approvedAt: new Date(),
          }),
        );
      }
      sellerIds.push(seller.id);
    }

    console.log(`  ✓ 사용자 ${userIds.length}명, 셀러 ${sellerIds.length}명`);
    return { userIds, sellerIds };
  }

  // ─── 주문 + 주문 관련 audit_logs ────────────────────────────────────────────

  /**
   * orders, order_items, audit_logs(주문 이벤트) 을 한 번에 생성.
   *
   * 왜 orders 와 audit_logs 를 함께 만드는가:
   * - 대시보드 order-trend 차트는 audit_logs 의 ORDER_CREATED / PAYMENT_VERIFIED / ORDER_CANCELLED 를 집계
   * - orders 테이블의 상태와 audit_logs 의 이벤트가 일치해야 두 데이터 소스가 정합성을 가짐
   * - 따로 만들면 "주문은 결제됐는데 PAYMENT_VERIFIED 로그는 없음" 같은 불일치 발생
   */
  private async seedOrdersAndEvents(
    userIds: number[],
    sellerIds: number[],
    days: number,
    productPool: SeedProductRef[],
  ): Promise<void> {
    let totalOrders = 0;

    for (let d = days; d >= 0; d--) {
      const count = rand(5, 20);

      for (let i = 0; i < count; i++) {
        const createdAt = randomKstTime(d);
        const userId = userIds[rand(0, userIds.length - 1)];
        const dateStr = createdAt.toISOString().slice(0, 10).replace(/-/g, '');
        const orderNumber = `SEED-${dateStr}-${String(i).padStart(3, '0')}-${rand(1000, 9999)}`;

        // 상태 전이 결정
        let status: OrderStatus = OrderStatus.PENDING_PAYMENT;
        let paidAt: Date | null = null;
        let shippedAt: Date | null = null;
        let deliveredAt: Date | null = null;
        let completedAt: Date | null = null;
        let cancelledAt: Date | null = null;
        let cancellationReason: string | null = null;

        const r = Math.random();

        if (r < 0.05) {
          // 5% → 취소
          status = OrderStatus.CANCELLED;
          cancelledAt = addMinutes(createdAt, rand(5, 60));
          cancellationReason = `${SEED_MEMO_PREFIX} 테스트 취소`;
        } else if (r < 0.75) {
          // 70% → 결제 이상
          paidAt = addMinutes(createdAt, rand(1, 30));
          status = OrderStatus.PAID;

          if (Math.random() < 0.8) {
            shippedAt = addHours(paidAt, rand(2, 24));
            status = OrderStatus.SHIPPED;

            if (Math.random() < 0.8) {
              deliveredAt = addHours(shippedAt, rand(12, 48));
              status = OrderStatus.DELIVERED;

              if (Math.random() < 0.7) {
                completedAt = addDays(deliveredAt, rand(1, 7));
                status = OrderStatus.COMPLETED;
              }
            }
          }
        }
        // 나머지 25% → PENDING_PAYMENT (paidAt, shippedAt... 모두 null)

        const itemCount = rand(1, 2);
        // §3-C: 실제 published 상품에서 itemCount 개를 뽑아 주문 상품으로 사용.
        //       (쓰기 흐름 시연용 — 시드 유저가 구매확정 주문에서 실제 상품에 리뷰 작성 가능)
        //       풀이 비면 기존 합성값(999999)으로 폴백.
        const chosenItems = this.pickOrderItems(productPool, itemCount);
        const totalAmount = chosenItems.reduce((sum, it) => sum + it.price, 0);

        // ── orders INSERT (raw SQL: @CreateDateColumn 을 우회해 과거 시각 직접 삽입) ──
        const orderResult: { id: number }[] = await this.ds.query(
          `INSERT INTO orders (
            order_number, user_id, status, total_amount,
            shipping_address, recipient_name, recipient_phone, memo,
            paid_at, cancelled_at, cancellation_reason,
            shipped_at, delivered_at, completed_at,
            "createdAt", "updatedAt"
          ) VALUES (
            $1,  $2,  $3,  $4,
            $5,  $6,  $7,  $8,
            $9,  $10, $11,
            $12, $13, $14,
            $15, $15
          ) RETURNING id`,
          [
            orderNumber,
            userId,
            status,
            totalAmount,
            '서울시 강남구 테헤란로 1 (시드)',
            '시드수령인',
            '010-0000-0000',
            `${SEED_MEMO_PREFIX} 시드주문`,
            paidAt,
            cancelledAt,
            cancellationReason,
            shippedAt,
            deliveredAt,
            completedAt,
            createdAt,
          ],
        );
        const orderId = orderResult[0].id;

        // ── order_items INSERT ──
        for (const item of chosenItems) {
          const sellerId = sellerIds[rand(0, sellerIds.length - 1)];
          await this.ds.query(
            `INSERT INTO order_items (
              order_id, product_id, seller_id,
              product_name, product_price, product_image_url,
              quantity, subtotal,
              "createdAt", "updatedAt"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
            [
              orderId,
              item.productId,
              sellerId,
              item.name,
              item.price,
              item.imageUrl,
              1,
              item.price,
              createdAt,
            ],
          );
        }

        // ── 주문 이벤트 audit_logs INSERT ──
        await this.insertAuditLog(
          AuditAction.ORDER_CREATED,
          userId,
          createdAt,
          true,
        );

        if (paidAt) {
          await this.insertAuditLog(
            AuditAction.PAYMENT_VERIFIED,
            userId,
            paidAt,
            true,
          );
        }

        if (cancelledAt) {
          await this.insertAuditLog(
            AuditAction.ORDER_CANCELLED,
            userId,
            cancelledAt,
            true,
          );
        }

        totalOrders++;
      }
    }

    console.log(`  ✓ 주문 ${totalOrders}건 (${days + 1}일치)`);
  }

  /**
   * 주문 1건에 들어갈 order_items 를 실제 상품 풀에서 중복 없이 선택.
   * 풀이 비어 있으면 기존 합성 상품(999999)으로 폴백.
   */
  private pickOrderItems(
    productPool: SeedProductRef[],
    itemCount: number,
  ): { productId: number; name: string; price: number; imageUrl: string | null }[] {
    if (productPool.length === 0) {
      // 폴백: 실제 상품이 없을 때만 합성값 사용(과거 동작 유지)
      const idx = rand(0, PRODUCT_PRICES.length - 1);
      return Array.from({ length: itemCount }, () => ({
        productId: 999999,
        name: PRODUCT_NAMES[idx],
        price: PRODUCT_PRICES[idx],
        imageUrl: null,
      }));
    }

    const pool = [...productPool];
    const out: { productId: number; name: string; price: number; imageUrl: string | null }[] = [];
    const n = Math.min(itemCount, pool.length);
    for (let i = 0; i < n; i++) {
      const idx = rand(0, pool.length - 1);
      const p = pool[idx];
      out.push({ productId: p.id, name: p.name, price: p.price, imageUrl: p.imageUrl });
      pool.splice(idx, 1);
    }
    return out;
  }

  // ─── 로그인 보안 audit_logs ─────────────────────────────────────────────────

  /**
   * LOGIN / FAILED_LOGIN / ACCOUNT_LOCKED 로그를 일별로 삽입.
   *
   * SPIKE_DAYS(10일 전, 20일 전)는 실패율을 22%로 올려 보안 차트의
   * markLine(10% 임계선) 초과 → 빨간 막대를 눈으로 검증할 수 있게 한다.
   */
  private async seedLoginAudit(userIds: number[], days: number): Promise<void> {
    let totalLogs = 0;

    for (let d = days; d >= 0; d--) {
      const loginCount = rand(30, 80);
      const failRatio = SPIKE_DAYS.has(d) ? 0.22 : 0.07;
      const failedCount = Math.round(loginCount * failRatio);

      // 성공 로그인
      for (let i = 0; i < loginCount; i++) {
        await this.insertAuditLog(
          AuditAction.LOGIN,
          userIds[rand(0, userIds.length - 1)],
          randomKstTime(d),
          true,
        );
      }

      // 실패 로그인
      for (let i = 0; i < failedCount; i++) {
        await this.ds.query(
          `INSERT INTO audit_logs (action, "userId", "ipAddress", "userAgent", metadata, success, "errorMessage", "createdAt")
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
          [
            AuditAction.FAILED_LOGIN,
            null,
            `10.0.0.${rand(1, 254)}`,
            'Seed/1.0',
            JSON.stringify(SEED_METADATA),
            false,
            'wrong password',
            randomKstTime(d, 0, 23),
          ],
        );
      }

      // 계정 잠금: spike 날에만
      if (SPIKE_DAYS.has(d)) {
        const lockedCount = rand(2, 4);
        for (let i = 0; i < lockedCount; i++) {
          await this.insertAuditLog(
            AuditAction.ACCOUNT_LOCKED,
            userIds[rand(0, userIds.length - 1)],
            randomKstTime(d),
            false,
            'too many failed attempts',
          );
        }
      }

      totalLogs += loginCount + failedCount;
    }

    console.log(`  ✓ 보안 audit_logs ${totalLogs}건 (${days + 1}일치)`);
  }

  // ─── 관리자 행위(버킷 C) + 시스템 오류(버킷 B) audit_logs ──────────────────────

  /**
   * 감사로그 뷰어(ex-audit-log-admin §3-3)가 보여줄 두 버킷을 채운다.
   *
   * - 버킷 C(관리자 행위/책임추적): SELLER_APPROVED / PRODUCT_APPROVED·REJECTED /
   *   PAYMENT_CANCELLED_ADMIN / SETTLEMENT_CONFIRMED·PAID.
   *   행위자(actor)는 데모 관리자(DEMO_ADMIN_EMAIL)가 있으면 그 userId, 없으면 null +
   *   metadata.actorLabel 로 표시.
   * - 버킷 B(시스템 오류): success=false + errorMessage (결제검증/웹훅/크론 실패). 드물게.
   *
   * ⚠ "로그 전용(log-only)" 주의: 시드는 상품·정산 행을 만들지 않으므로
   *   PRODUCT/SETTLEMENT 계열 액션은 대응 엔티티 없이 "로그만" 존재한다(상품 승인/정산
   *   프론트는 별도 Phase 영역). SELLER_APPROVED 는 시드 셀러가 이미 APPROVED 라 상태와 정합.
   */
  private async seedAdminAndSystemAudit(
    userIds: number[],
    sellerIds: number[],
    days: number,
  ): Promise<void> {
    const adminId = await this.resolveAdminActorId();
    const actorMeta: Record<string, any> = adminId
      ? {}
      : { actorLabel: '데모 관리자(미생성 — DEMO_ADMIN_EMAIL 없음)' };
    let count = 0;

    // ── 버킷 C: 관리자 행위 ──
    // 셀러 승인: 시드 셀러는 이미 APPROVED(seedUsers) → 로그만 추가(상태와 정합).
    for (const sellerId of sellerIds) {
      await this.insertAuditLog(
        AuditAction.SELLER_APPROVED,
        adminId,
        randomKstTime(rand(1, days)),
        true,
        null,
        { ...actorMeta, sellerId },
      );
      count++;
    }

    // 상품 승인/반려: 로그 전용(시드는 상품 행을 만들지 않음).
    for (let i = 0; i < 4; i++) {
      const rejected = i === 3;
      await this.insertAuditLog(
        rejected ? AuditAction.PRODUCT_REJECTED : AuditAction.PRODUCT_APPROVED,
        adminId,
        randomKstTime(rand(1, days)),
        true,
        null,
        {
          ...actorMeta,
          productId: 900000 + i,
          note: 'log-only(상품 시드 없음)',
          ...(rejected ? { reason: '상품 정보 불충분' } : {}),
        },
      );
      count++;
    }

    // 관리자 결제 강제취소 1~2건.
    const adminCancelCount = rand(1, 2);
    for (let i = 0; i < adminCancelCount; i++) {
      await this.insertAuditLog(
        AuditAction.PAYMENT_CANCELLED_ADMIN,
        adminId,
        randomKstTime(rand(1, days)),
        true,
        null,
        { ...actorMeta, reason: '고객 요청 환불', note: 'log-only' },
      );
      count++;
    }

    // 정산 확정/지급: 로그 전용(정산 행 미시드 — 정산 프론트는 별도 Phase).
    for (let i = 0; i < sellerIds.length; i++) {
      await this.insertAuditLog(
        AuditAction.SETTLEMENT_CONFIRMED,
        adminId,
        randomKstTime(rand(1, days)),
        true,
        null,
        { ...actorMeta, sellerId: sellerIds[i], note: 'log-only(정산 행 미시드)' },
      );
      count++;
      if (i % 2 === 0) {
        await this.insertAuditLog(
          AuditAction.SETTLEMENT_PAID,
          adminId,
          randomKstTime(rand(1, days)),
          true,
          null,
          { ...actorMeta, sellerId: sellerIds[i], note: 'log-only(정산 행 미시드)' },
        );
        count++;
      }
    }

    // ── 버킷 B: 시스템 오류(success=false) — 드물게 ──
    // 결제 검증 실패(금액 불일치).
    const payFailCount = rand(2, 4);
    for (let i = 0; i < payFailCount; i++) {
      await this.insertAuditLog(
        AuditAction.PAYMENT_VERIFIED,
        userIds[rand(0, userIds.length - 1)],
        randomKstTime(rand(0, days)),
        false,
        'amount mismatch: expected !== paid',
      );
      count++;
    }

    // 웹훅 처리 실패(서명 검증 실패) — 무인 동작이라 userId=null.
    const webhookFailCount = rand(1, 3);
    for (let i = 0; i < webhookFailCount; i++) {
      await this.insertAuditLog(
        AuditAction.PAYMENT_WEBHOOK,
        null,
        randomKstTime(rand(0, days)),
        false,
        'webhook signature verification failed',
      );
      count++;
    }

    // 크론 자동만료 실패 — 시스템 자동 동작 가시성.
    const cronFailCount = rand(1, 2);
    for (let i = 0; i < cronFailCount; i++) {
      await this.insertAuditLog(
        AuditAction.CRON_ORDER_EXPIRED,
        null,
        randomKstTime(rand(0, days)),
        false,
        'failed to expire order: DB deadlock',
      );
      count++;
    }

    console.log(`  ✓ 관리자행위·시스템오류 audit_logs ${count}건 (버킷 B·C)`);
  }

  /**
   * 버킷 C 관리자 행위의 행위자(actor) userId 해석.
   * 데모 관리자(DEMO_ADMIN_EMAIL)가 있으면 그 id, 없으면 null(호출부에서 metadata로 표시).
   */
  private async resolveAdminActorId(): Promise<number | null> {
    const email = process.env['DEMO_ADMIN_EMAIL'];
    if (!email) return null;
    const admin = await this.userRepo.findOne({ where: { email } });
    return admin?.id ?? null;
  }

  // ─── 공통 audit_logs INSERT ─────────────────────────────────────────────────

  private async insertAuditLog(
    action: AuditAction,
    userId: number | null,
    createdAt: Date,
    success: boolean,
    errorMessage: string | null = null,
    metadata: Record<string, any> = {},
  ): Promise<void> {
    await this.ds.query(
      `INSERT INTO audit_logs (action, "userId", "ipAddress", "userAgent", metadata, success, "errorMessage", "createdAt")
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        action,
        userId,
        `192.168.1.${rand(1, 254)}`,
        'Seed/1.0',
        // SEED_METADATA(마커)는 항상 유지 — SEED_RESET 정리 대상이 되도록.
        JSON.stringify({ ...SEED_METADATA, ...metadata }),
        success,
        errorMessage,
        createdAt,
      ],
    );
  }

  // ─── 멱등성 체크 / 초기화 ───────────────────────────────────────────────────

  /** audit_logs 에 seed 마커가 있으면 이미 삽입된 것으로 판단 */
  private async isSeedDataPresent(): Promise<boolean> {
    const rows: { cnt: string }[] = await this.ds.query(
      `SELECT COUNT(*) AS cnt FROM audit_logs WHERE metadata::jsonb->>'seed' = 'v1'`,
    );
    return Number(rows[0].cnt) > 0;
  }

  /**
   * 시드 데이터 삭제 (--reset / SEED_RESET=true).
   *
   * 왜 email LIKE '%@seed.com' 을 기준으로 삭제하는가:
   * - 실제 운영 데이터(운영 admin, 일반 회원)는 건드리지 않기 위함
   * - 시드 사용자는 모두 @seed.com 도메인을 씀
   */
  private async resetSeedData(): Promise<void> {
    console.log('  🗑️   기존 시드 데이터 삭제 중...');

    // settlements 가 orders 를 FK 참조(order_id) → 주문 삭제 전에 먼저 정리.
    // (시드 주문이 COMPLETED 까지 진행되면 정산 행이 자동 생성될 수 있음)
    await this.ds.query(
      `DELETE FROM settlements
       WHERE order_id IN (SELECT id FROM orders WHERE memo LIKE $1)`,
      [`${SEED_MEMO_PREFIX}%`],
    );
    await this.ds.query(
      `DELETE FROM order_items
       WHERE order_id IN (SELECT id FROM orders WHERE memo LIKE $1)`,
      [`${SEED_MEMO_PREFIX}%`],
    );
    await this.ds.query(
      `DELETE FROM orders WHERE memo LIKE $1`,
      [`${SEED_MEMO_PREFIX}%`],
    );
    await this.ds.query(
      `DELETE FROM audit_logs WHERE metadata::jsonb->>'seed' = 'v1'`,
    );
    // 커버리지 리뷰(§3-B) 정리 — reviews.user_id 가 users FK 라 유저 삭제 전에 제거.
    // 삭제 후 상품 집계는 다음 reseed 의 일괄 재계산(ReviewSeedService)이 정정.
    await this.ds.query(
      `DELETE FROM reviews
       WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@seed.com')`,
    );
    // 문의(Phase 5a) 정리 — inquiries.user_id 가 users FK 라 유저 삭제 전에 제거.
    await this.ds.query(
      `DELETE FROM inquiries
       WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@seed.com')`,
    );
    await this.ds.query(
      `DELETE FROM sellers
       WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@seed.com')`,
    );
    await this.ds.query(
      `DELETE FROM user_roles
       WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@seed.com')`,
    );
    await this.ds.query(`DELETE FROM users WHERE email LIKE '%@seed.com'`);

    // DEMO_RESET=true 일 때만 데모 관리자도 함께 삭제
    if (process.env['DEMO_RESET'] === 'true') {
      const demoEmail = process.env['DEMO_ADMIN_EMAIL'];
      if (demoEmail) {
        await this.ds.query(
          `DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email = $1)`,
          [demoEmail],
        );
        await this.ds.query(`DELETE FROM users WHERE email = $1`, [demoEmail]);
        console.log(`  ✓ 데모 관리자 삭제: ${demoEmail}`);
      }
    }

    console.log('  ✓ 삭제 완료\n');
  }
}
