import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { UserModel } from '../user/entity/user.entity';
import { SellerEntity, SellerStatus } from '../seller/entity/seller.entity';
import { DemoFixtureEntity, DEMO_SCOPE } from './entity/demo-fixture.entity';
import { mockProductCatalog } from '../common/seeds/mock-product-catalog';
import { InquiryEntity, InquiryStatus } from '../inquiry/entity/inquiry.entity';
import { CreateInquiryDto } from '../inquiry/dto/create-inquiry.dto';
import { SearchIndexRecorder } from '../search/search-index-recorder';

export type DemoRole = 'buyer' | 'seller' | 'admin';
export const DEMO_ROLES: DemoRole[] = ['buyer', 'seller', 'admin'];
export function demoConfigKey(role: DemoRole, field: 'EMAIL' | 'PASSWORD') {
  return `DEMO_${role.toUpperCase()}_${field}`;
}

@Injectable()
export class DemoPolicyService {
  constructor(private readonly ds: DataSource, @Optional() private readonly searchJobs?: SearchIndexRecorder) {}

  async user(userId: number, manager = this.ds.manager) {
    return manager.findOne(UserModel, { where: { id: userId } });
  }
  async forbidDemo(userId: number) {
    if ((await this.user(userId))?.isDemo)
      throw new ForbiddenException(
        '공용 체험 계정에서는 사용할 수 없는 기능입니다.'
      );
  }
  async isFixtureOrder(orderId: number, manager = this.ds.manager) {
    return !!(await manager.findOne(DemoFixtureEntity, {
      where: { scope: DEMO_SCOPE, orderId },
    }));
  }
  async forbidFixtureOrder(orderId: number, manager = this.ds.manager) {
    if (await this.isFixtureOrder(orderId, manager))
      throw new ForbiddenException(
        '실제 결제가 없는 체험 주문은 환불·정산 지급 대상이 아닙니다.'
      );
  }
  async assertOrderActor(
    userId: number,
    orderId: number,
    manager = this.ds.manager
  ) {
    if (!(await this.user(userId, manager))?.isDemo) return;
    if (!(await this.isFixtureOrder(orderId, manager)))
      throw new ForbiddenException(
        '체험 계정은 준비된 체험 주문만 변경할 수 있습니다.'
      );
    // Reuse the caller's connection: acquiring another connection inside a locked
    // transaction can exhaust the pool. Require a valid row rather than assuming
    // that missing buyer/seller/item joins mean there is no invalid row.
    const [valid] = await manager.query(
      `SELECT o.id FROM orders o
      JOIN users u ON u.id=o.user_id
      WHERE o.id=$1 AND u.is_demo=true AND u.email=$2
        AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=o.id)
        AND NOT EXISTS (
          SELECT 1 FROM order_items oi LEFT JOIN sellers s ON s.id=oi.seller_id LEFT JOIN users su ON su.id=s.user_id
          WHERE oi.order_id=o.id AND (su.id IS NULL OR su.is_demo=false OR su.email<>$3))`,
      [
        orderId,
        process.env.DEMO_BUYER_EMAIL || '',
        process.env.DEMO_SELLER_EMAIL || '',
      ]
    );
    if (!valid)
      throw new ForbiddenException(
        '체험 주문의 계정 연결이 올바르지 않습니다.'
      );
  }
  async assertInquiryActor(userId: number, inquiry: InquiryEntity, manager: EntityManager = this.ds.manager) {
    if (!(await this.user(userId, manager))?.isDemo) return;
    const buyer = await this.user(inquiry.userId, manager);
    if (!buyer?.isDemo || buyer.email !== process.env.DEMO_BUYER_EMAIL) {
      throw new ForbiddenException(
        '일반 구매자의 문의에는 체험 계정으로 답변할 수 없습니다.'
      );
    }
  }
  async catalogSeller(manager = this.ds.manager) {
    return manager.findOne(SellerEntity, {
      where: {
        status: SellerStatus.APPROVED,
        user: { email: process.env.TEST_SELLER_EMAIL || 'seller1@seed.com', isDemo: false },
      },
    });
  }
  async fixtureOrderIds() {
    return (await this.ds.manager.find(DemoFixtureEntity, {
      where: { scope: DEMO_SCOPE },
    })).flatMap((fixture) => fixture.orderId == null ? [] : [fixture.orderId]);
  }
  async demoInquiryIds(sellerId: number) {
    const rows: { id: number }[] = await this.ds.query(
      `SELECT i.id FROM inquiries i JOIN users u ON u.id=i.user_id
       WHERE i.seller_id=$1 AND u.is_demo=true AND u.email=$2`,
      [sellerId, process.env.DEMO_BUYER_EMAIL || '']
    );
    return rows.map((row) => row.id);
  }
  async assertTestDeliveryActor(userId: number, orderId: number, manager = this.ds.manager) {
    const user = await this.user(userId, manager);
    if (process.env.TEST_DELIVERY_ENABLED !== 'true' || !user?.isDemo || user.email !== process.env.DEMO_BUYER_EMAIL)
      throw new ForbiddenException('테스트 배송은 구매자 체험 계정의 준비된 주문에서만 가능합니다.');
    await this.assertOrderActor(userId, orderId, manager);
    const order = await manager.findOne('OrderEntity', { where: { id: orderId, userId } });
    if (!order) throw new ForbiddenException('본인의 체험 주문만 처리할 수 있습니다.');
  }
  async canTestDeliver(userId: number, orderId: number) {
    try {
      await this.assertTestDeliveryActor(userId, orderId);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }
  async createDemoInquiry(
    userId: number,
    dto: CreateInquiryDto
  ): Promise<InquiryEntity | null> {
    if (!(await this.user(userId))?.isDemo) return null;
    return this.ds.transaction(async (manager) => {
      const buyer = await manager.findOne(UserModel, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!buyer?.isDemo || buyer.email !== process.env.DEMO_BUYER_EMAIL)
        throw new ForbiddenException(
          '문의 작성은 구매자 체험 계정에서 가능합니다.'
        );
      const [product] = await manager.query(
        `SELECT p.id, p.seller_id FROM products p
        JOIN sellers s ON s.id=p.seller_id JOIN users u ON u.id=s.user_id
        WHERE p.id=$1 AND p.seed_key=ANY($2::varchar[]) AND p.status='published' AND p.approval_status='approved'
          AND s.status='approved' AND u.is_demo=false AND u.email=$3`,
        [
          dto.productId,
          mockProductCatalog.map((p) => p.seedKey),
          process.env.TEST_SELLER_EMAIL || 'seller1@seed.com',
        ]
      );
      if (!product)
        throw new ForbiddenException(
          '체험 셀러의 샘플 상품에만 문의를 작성할 수 있습니다.'
        );
      const demoSeller = await manager.findOne(SellerEntity, {
        where: { status: SellerStatus.APPROVED, user: { isDemo: true, email: process.env.DEMO_SELLER_EMAIL || '' } },
      });
      if (!demoSeller) throw new ForbiddenException('체험 셀러가 준비되지 않았습니다.');
      const total = await manager.count(InquiryEntity, { where: { userId } });
      const waiting = await manager.count(InquiryEntity, {
        where: { userId, status: InquiryStatus.WAITING },
      });
      if (total >= 100 || waiting >= 10)
        throw new HttpException(
          {
            message:
              total >= 100
                ? '공용 문의 체험 한도에 도달했습니다.'
                : '미답변 문의가 많습니다. 셀러 체험에서 답변 후 다시 작성하세요.',
            code: 'DEMO_INQUIRY_LIMIT',
          },
          HttpStatus.TOO_MANY_REQUESTS
        );
      const saved = await manager.save(
        InquiryEntity,
        manager.create(InquiryEntity, {
          userId,
          sellerId: demoSeller.id,
          productId: dto.productId,
          title: dto.title,
          content: dto.content,
          isSecret: dto.isSecret ?? false,
          status: InquiryStatus.WAITING,
        })
      );
      await this.searchJobs?.recordInquiry(manager, saved.id);
      return saved;
    });
  }
  async status(userId: number) {
    const user = await this.user(userId);
    if (
      !user?.isDemo ||
      ![process.env.DEMO_BUYER_EMAIL, process.env.DEMO_SELLER_EMAIL].includes(
        user.email
      )
    )
      throw new ForbiddenException();
    const [result] = await this.ds.query(
      `SELECT
      count(*) FILTER(WHERE o.status='preparing')::int AS "preparingOrders",
      count(*) FILTER(WHERE o.status='shipped')::int AS "shippedOrders",
      count(*) FILTER(WHERE o.status='delivered')::int AS "deliveredOrders",
      (SELECT count(*)::int FROM demo_fixtures f JOIN orders ro ON ro.id=f.order_id JOIN order_items oi ON oi.order_id=ro.id
        WHERE f.scope=$1 AND ro.status='completed' AND NOT EXISTS(SELECT 1 FROM reviews r WHERE r.order_id=ro.id AND r.product_id=oi.product_id AND r.user_id=ro.user_id)) AS "reviewableItems",
      (SELECT count(*)::int FROM inquiries i JOIN users u ON u.id=i.user_id WHERE u.is_demo=true AND u.email=$2 AND i.status='waiting') AS "waitingInquiries"
      FROM demo_fixtures f JOIN orders o ON o.id=f.order_id WHERE f.scope=$1`,
      [DEMO_SCOPE, process.env.DEMO_BUYER_EMAIL || '']
    );
    return {
      ...result,
      testDeliveryEnabled: process.env.TEST_DELIVERY_ENABLED === 'true',
    };
  }
  async approvedSeller(userId: number) {
    return this.ds.manager.findOne(SellerEntity, {
      where: { userId, status: SellerStatus.APPROVED },
    });
  }
}
