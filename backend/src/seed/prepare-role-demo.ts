import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import Redis from 'ioredis';
import { UserModel } from '../user/entity/user.entity';
import { RoleEntity } from '../user/entity/role.entity';
import { SellerEntity, SellerStatus } from '../seller/entity/seller.entity';
import {
  ProductEntity,
  ApprovalStatus,
  ProductStatus,
} from '../product/entity/product.entity';
import { OrderEntity, OrderStatus } from '../order/entity/order.entity';
import { OrderItemEntity } from '../order/entity/order-item.entity';
import {
  ShipmentEntity,
  ShipmentStatus,
} from '../order/entity/shipment.entity';
import { PaymentEntity, PaymentStatus } from '../payment/entity/payment.entity';
import { InquiryEntity, InquiryStatus } from '../inquiry/entity/inquiry.entity';
import {
  DemoFixtureEntity,
  DEMO_SCOPE,
} from '../demo/entity/demo-fixture.entity';
import { mockProductCatalog } from '../common/seeds/mock-product-catalog';
import { AuditLogEntity, AuditAction } from '../audit/entity/audit-log.entity';
import { SearchIndexRecorder } from '../search/search-index-recorder';

export interface PrepareDemoOptions {
  apply: boolean;
  replenish?: boolean;
}
export async function prepareRoleDemo(
  ds: DataSource,
  options: PrepareDemoOptions
) {
  // Leaf recorder shares the source transaction and never constructs an AI client.
  const searchJobs = new SearchIndexRecorder(new ConfigService());
  const buyerEmail = process.env.DEMO_BUYER_EMAIL;
  const sellerEmail = process.env.DEMO_SELLER_EMAIL;
  const buyerPassword = process.env.DEMO_BUYER_PASSWORD;
  const sellerPassword = process.env.DEMO_SELLER_PASSWORD;
  if (!buyerEmail || !sellerEmail || !buyerPassword || !sellerPassword)
    throw new Error('DEMO_BUYER/SELLER_EMAIL/PASSWORD 설정이 필요합니다.');
  if (
    buyerEmail === sellerEmail ||
    [buyerEmail, sellerEmail].includes(process.env.DEMO_ADMIN_EMAIL || '')
  )
    throw new Error('체험 계정 이메일은 서로 달라야 합니다.');
  const catalogEmail = process.env.TEST_SELLER_EMAIL || 'seller1@seed.com';
  if ([buyerEmail, sellerEmail, process.env.DEMO_ADMIN_EMAIL].includes(catalogEmail))
    throw new Error('Mock 상품의 판매자는 공용 체험 계정과 분리해야 합니다.');
  return ds.transaction(async (manager) => {
    if (options.apply)
      await manager.query('SELECT pg_advisory_xact_lock(1791763200)');
    const roleRows = await manager.find(RoleEntity);
    if (
      !['buyer', 'seller', 'admin'].every((r) =>
        roleRows.some((row) => row.name === r)
      )
    )
      throw new Error('역할 시드를 먼저 준비하세요.');
    if (
      !(await manager
        .query('SELECT 1 FROM categories LIMIT 1')
        .then((rows) => rows.length))
    )
      throw new Error('카테고리 시드를 먼저 준비하세요.');
    const buyer = await manager.findOne(UserModel, {
      where: { email: buyerEmail },
      relations: ['roles'],
    });
    const sellerUser = await manager.findOne(UserModel, {
      where: { email: sellerEmail },
      relations: ['roles'],
    });
    for (const [user, expected, password] of [
      [buyer, ['buyer'], buyerPassword],
      [sellerUser, ['buyer', 'seller'], sellerPassword],
    ] as const) {
      if (
        user &&
        (!user.isDemo ||
          !user.isEmailVerified ||
          user.roles.length !== expected.length ||
          !expected.every((r) => user.roles.some((row) => row.name === r)) ||
          !(await bcrypt.compare(password, user.password)))
      )
        throw new Error(
          '기존 체험 계정의 역할·비밀번호·상태가 설정과 다릅니다. 자동 변경하지 않습니다.'
        );
    }
    let seller = sellerUser
      ? await manager.findOne(SellerEntity, {
          where: { userId: sellerUser.id },
        })
      : null;
    if (sellerUser && (!seller || seller.status !== SellerStatus.APPROVED))
      throw new Error(
        '기존 체험 셀러의 승인 레코드가 없거나 승인 상태가 아닙니다.'
      );
    if (options.apply && buyer)
      await manager.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [
        buyer.id,
      ]);
    const products = await manager.find(ProductEntity, {
      relations: ['images'],
    });
    const keys = new Set(mockProductCatalog.map((p) => p.seedKey));
    const catalog = products.filter((p) => p.seedKey && keys.has(p.seedKey));
    if (!catalog.length)
      throw new Error('seedKey가 지정된 Mock 카탈로그를 먼저 준비하세요.');
    const [catalogSeller] = await manager.query(
      `SELECT s.id FROM sellers s JOIN users u ON u.id=s.user_id
       WHERE u.email=$1 AND u.is_demo=false AND s.status='approved'
       AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name='seller')`,
      [catalogEmail]
    );
    if (!catalogSeller) throw new Error('승인된 일반 카탈로그 셀러를 먼저 준비하세요.');
    const previousEmail = process.env.DEMO_PREVIOUS_SELLER_EMAIL;
    const previous = previousEmail
      ? await manager.query(
          'SELECT s.id FROM sellers s JOIN users u ON u.id=s.user_id WHERE u.email=$1',
          [previousEmail]
        )
      : [];
    const moves = catalog.filter((p) => p.sellerId !== catalogSeller.id);
    if (
      moves.some((p) => p.sellerId !== null && p.sellerId !== previous[0]?.id)
    )
      throw new Error(
        '예상하지 않은 카탈로그 소유자입니다. DEMO_PREVIOUS_SELLER_EMAIL을 명시하고 dry-run을 검토하세요.'
      );
    let published = catalog.filter(
      (p) =>
        p.status === ProductStatus.PUBLISHED &&
        p.approvalStatus === ApprovalStatus.APPROVED
    );
    if (!published.length) throw new Error('구매 가능한 체험 상품이 없습니다.');
    const fixtures = await manager.find(DemoFixtureEntity, {
      where: { scope: DEMO_SCOPE },
      relations: ['order', 'inquiry'],
    });
    if (
      fixtures.some((f) => {
        const match = /^(preparing|shipped|inquiry)\/(\d{6,})$/.exec(
          f.fixtureKey
        );
        return (
          !match ||
          !Number.isSafeInteger(Number(match[2])) ||
          Number(match[2]) < 1 ||
          (match[1] === 'inquiry' ? !f.inquiryId : !f.orderId)
        );
      })
    )
      throw new Error('기존 fixture 키 또는 대상 종류가 올바르지 않습니다.');
    if (
      fixtures.some(
        (f) =>
          (f.order && f.order.userId !== buyer?.id) ||
          (f.inquiry &&
            (f.inquiry.userId !== buyer?.id ||
              f.inquiry.sellerId !== seller?.id))
      )
    )
      throw new Error('기존 fixture의 소유권이 설정과 다릅니다.');
    const invalid = await manager.query(
      `SELECT f.id FROM demo_fixtures f JOIN orders o ON o.id=f.order_id
      LEFT JOIN payments p ON p.order_id=o.id WHERE f.scope=$1 AND (
        p.id IS NULL OR p.status<>'paid' OR p.amount<>o.total_amount OR p.imp_uid IS NOT NULL OR p.receipt_url IS NOT NULL
        OR NOT EXISTS(SELECT 1 FROM order_items oi WHERE oi.order_id=o.id)
        OR (SELECT sum(oi.subtotal) FROM order_items oi WHERE oi.order_id=o.id)<>o.total_amount
        OR o.status NOT IN ('preparing','shipped','delivered','completed')
        OR EXISTS(SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND (oi.seller_id IS DISTINCT FROM $2
          OR NOT EXISTS(SELECT 1 FROM shipments sh WHERE sh.order_id=o.id AND sh.seller_id=oi.seller_id)))
        OR EXISTS(SELECT 1 FROM shipments sh WHERE sh.order_id=o.id AND (
          sh.seller_id IS DISTINCT FROM $2 OR sh.status::text <> CASE WHEN o.status='completed' THEN 'delivered' ELSE o.status::text END)))`,
      [DEMO_SCOPE, seller?.id ?? null]
    );
    if (invalid.length)
      throw new Error(
        '기존 fixture의 결제·주문 항목·배송 정합성이 올바르지 않습니다.'
      );
    const plans: { kind: string; count: number }[] = [
      {
        kind: 'preparing',
        count: options.replenish
          ? Math.max(
              0,
              3 -
                fixtures.filter(
                  (f) => f.order?.status === OrderStatus.PREPARING
                ).length
            )
          : Math.max(
              0,
              3 -
                fixtures.filter((f) => f.fixtureKey.startsWith('preparing/'))
                  .length
            ),
      },
      {
        kind: 'shipped',
        count: options.replenish
          ? Math.max(
              0,
              2 -
                fixtures.filter((f) => f.order?.status === OrderStatus.SHIPPED)
                  .length
            )
          : Math.max(
              0,
              2 -
                fixtures.filter((f) => f.fixtureKey.startsWith('shipped/'))
                  .length
            ),
      },
    ];
    const inquiryTotal = buyer
      ? await manager.count(InquiryEntity, { where: { userId: buyer.id } })
      : 0;
    const waiting = buyer
      ? await manager.count(InquiryEntity, {
          where: { userId: buyer.id, status: InquiryStatus.WAITING },
        })
      : 0;
    plans.push({
      kind: 'inquiry',
      count: Math.max(
        0,
        Math.min(
          100 - inquiryTotal,
          10 - waiting,
          options.replenish
            ? Math.max(0, 3 - waiting)
            : Math.max(0, 3 - fixtures.filter((f) => f.inquiryId).length)
        )
      ),
    });
    const report = {
      apply: options.apply,
      database: ds.options.database,
      createBuyer: !buyer,
      createSeller: !sellerUser,
      productIdsToMove: moves.map((p) => p.id),
      cacheProductIds: catalog.map((p) => p.id),
      plans,
      inquiryLimitReached: inquiryTotal >= 100,
    };
    if (!options.apply) return report;
    // Only explicitly reviewed catalog rows can be repaired to the ordinary seller.
    const locked = await manager.findByIds(
      ProductEntity,
      catalog.map((p) => p.id)
    );
    await manager.query(
      'SELECT id FROM products WHERE id=ANY($1::int[]) FOR UPDATE',
      [locked.map((p) => p.id)]
    );
    const current = await manager.findByIds(
      ProductEntity,
      catalog.map((p) => p.id)
    );
    if (
      current.length !== catalog.length ||
      current.some((p) => !p.seedKey || !keys.has(p.seedKey))
    )
      throw new Error('검토 후 샘플 상품 구성이 변경되었습니다.');
    published = current
      .filter(
        (p) =>
          p.status === ProductStatus.PUBLISHED &&
          p.approvalStatus === ApprovalStatus.APPROVED
      )
      .map((p) =>
        Object.assign(p, {
          images: catalog.find((original) => original.id === p.id)?.images,
        })
      );
    if (!published.length) throw new Error('구매 가능한 체험 상품이 없습니다.');
    if (
      current.some(
        (p) =>
          p.sellerId !== catalogSeller.id &&
          p.sellerId !== null &&
          p.sellerId !== previous[0]?.id
      )
    )
      throw new Error('검토 후 상품 소유권이 변경되었습니다.');
    async function account(
      email: string,
      password: string,
      names: string[],
      nickname: string
    ) {
      return manager.save(
        UserModel,
        manager.create(UserModel, {
          email,
          password: await bcrypt.hash(password, 10),
          roles: roleRows.filter((r) => names.includes(r.name)),
          nickName: nickname,
          phoneNumber: '010-0000-0000',
          address: '공용 체험용 합성 주소',
          isDemo: true,
          isEmailVerified: true,
        })
      );
    }
    const savedBuyer =
      buyer ??
      (await account(buyerEmail, buyerPassword, ['buyer'], '체험 구매자'));
    const savedSellerUser =
      sellerUser ??
      (await account(
        sellerEmail,
        sellerPassword,
        ['buyer', 'seller'],
        '체험 셀러'
      ));
    await manager.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [
      savedBuyer.id,
    ]);
    if (!seller)
      seller = await manager.save(
        SellerEntity,
        manager.create(SellerEntity, {
          userId: savedSellerUser.id,
          businessName: '체험 상점',
          businessNumber: 'DEMO-ROLE-V1',
          representativeName: '체험 셀러',
          businessAddress: '체험용 합성 주소',
          contactEmail: sellerEmail,
          contactPhone: '010-0000-0000',
          bankName: '체험용',
          bankAccountNumber: '0000000000',
          bankAccountHolder: '체험 셀러',
          status: SellerStatus.APPROVED,
          approvedAt: new Date(),
        })
      );
    for (const p of current)
      if (p.sellerId !== catalogSeller.id)
        await manager.update(ProductEntity, p.id, { sellerId: catalogSeller.id });
    const created: number[] = [];
    for (const plan of plans) {
      let sequence = Math.max(
        0,
        ...fixtures
          .filter((f) => f.fixtureKey.startsWith(plan.kind + '/'))
          .map((f) => Number(f.fixtureKey.split('/')[1]))
      );
      for (let i = 0; i < plan.count; i++) {
        const key = `${plan.kind}/${String(++sequence).padStart(6, '0')}`;
        const product = published[(sequence - 1) % published.length];
        if (plan.kind === 'inquiry') {
          const inquiry = await manager.save(
            InquiryEntity,
            manager.create(InquiryEntity, {
              userId: savedBuyer.id,
              sellerId: seller.id,
              productId: product.id,
              title: '[체험] 상품 문의',
              content:
                '배송 및 상품 안내를 요청하는 체험 문의입니다. 개인정보를 입력하지 마세요.',
              isSecret: sequence % 2 === 0,
              status: InquiryStatus.WAITING,
            })
          );
          await searchJobs.recordInquiry(manager, inquiry.id);
          const fixture = await manager.save(
            DemoFixtureEntity,
            manager.create(DemoFixtureEntity, {
              scope: DEMO_SCOPE,
              fixtureKey: key,
              inquiryId: inquiry.id,
            })
          );
          created.push(fixture.id);
        } else {
          const now = new Date();
          const shipped = plan.kind === 'shipped';
          const order = await manager.save(
            OrderEntity,
            manager.create(OrderEntity, {
              orderNumber: `DEMO-V1-${plan.kind.toUpperCase()}-${sequence}`,
              userId: savedBuyer.id,
              status: shipped ? OrderStatus.SHIPPED : OrderStatus.PREPARING,
              totalAmount: Number(product.price),
              shippingAddress: '체험용 합성 주소',
              recipientName: '체험 구매자',
              recipientPhone: '010-0000-0000',
              memo: '실제 결제 없이 준비된 체험 주문',
              paidAt: now,
              shippedAt: shipped ? now : null,
            })
          );
          await manager.save(
            OrderItemEntity,
            manager.create(OrderItemEntity, {
              orderId: order.id,
              productId: product.id,
              sellerId: seller.id,
              productName: product.name,
              productPrice: Number(product.price),
              productImageUrl: product.images?.[0]?.url ?? null,
              quantity: 1,
              subtotal: Number(product.price),
            })
          );
          await manager.save(
            PaymentEntity,
            manager.create(PaymentEntity, {
              orderId: order.id,
              paymentId: order.orderNumber,
              amount: Number(product.price),
              status: PaymentStatus.PAID,
              paidAt: now,
              rawResponse: { demoFixture: DEMO_SCOPE },
            })
          );
          await manager.save(
            ShipmentEntity,
            manager.create(ShipmentEntity, {
              orderId: order.id,
              sellerId: seller.id,
              status: shipped
                ? ShipmentStatus.SHIPPED
                : ShipmentStatus.PREPARING,
              shippedAt: shipped ? now : null,
              carrier: shipped ? '체험 택배' : null,
              trackingNumber: shipped ? `DEMO-${sequence}` : null,
            })
          );
          const fixture = await manager.save(
            DemoFixtureEntity,
            manager.create(DemoFixtureEntity, {
              scope: DEMO_SCOPE,
              fixtureKey: key,
              orderId: order.id,
            })
          );
          created.push(fixture.id);
        }
      }
    }
    if (created.length || moves.length || !buyer || !sellerUser)
      await manager.save(
        AuditLogEntity,
        manager.create(AuditLogEntity, {
          action: AuditAction.DEMO_DATA_REPAIRED,
          ipAddress: 'system',
          metadata: {
            scope: DEMO_SCOPE,
            fixtureIds: created,
            movedProductIds: moves.map((p) => p.id),
          },
          success: true,
        })
      );
    return { ...report, createdFixtureIds: created };
  });
}

export async function clearDemoProductCache(ids: number[]) {
  if (!ids.length) return;
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD,
    db: Number(process.env.REDIS_DB || 0),
    lazyConnect: true,
    retryStrategy: () => null,
    maxRetriesPerRequest: 1,
  });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    await redis.del(...ids.map((id) => `products:detail:${id}`));
    let cursor = '0';
    do {
      const scanned = await redis.scan(
        cursor,
        'MATCH',
        'products:list:*',
        'COUNT',
        100
      );
      cursor = scanned[0];
      if (scanned[1].length) await redis.del(...scanned[1]);
    } while (cursor !== '0');
  } finally {
    redis.disconnect();
  }
}
