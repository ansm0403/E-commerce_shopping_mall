import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  InquiryEntity,
  InquiryStatus,
} from '../inquiry/entity/inquiry.entity';
import { ProductEntity, ProductStatus } from '../product/entity/product.entity';
import { rand } from './seed-helpers';

/**
 * 소규모 문의(Q&A) 시드 — 관리자 AI 어시스턴트 `summarize_inquiries`(Phase 5a) 시연용.
 *
 * - 실 published 상품에 FK 연결(productId) + 시드 buyer(userId) + 시드 seller(sellerId).
 *   (현재 published 상품은 seller_id=NULL 이라 상품 소유 셀러를 못 쓴다 → 시드 셀러로 FK 충족.)
 * - 상태 혼합: 미답변(waiting) 다수 + 답변완료(answered) 일부 + 비밀문의(isSecret) 소수.
 * - 일부 비-비밀 문의 본문에 전화/이메일을 의도적으로 심어 `scrubText` 마스킹을 시연 가능하게 한다.
 * - NODE_SEED 게이트는 호출부(DashboardSeedService)가 담당. 멱등성은 "시드 buyer 문의 있으면 skip".
 */
@Injectable()
export class InquirySeedService {
  constructor(
    @InjectRepository(InquiryEntity)
    private readonly inquiryRepo: Repository<InquiryEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
  ) {}

  /** 미답변(waiting)으로 둘 질문 풀. 일부는 연락처 PII 를 포함(scrubText 시연용). */
  private static readonly WAITING: { title: string; content: string }[] = [
    {
      title: '배송 언제 시작되나요?',
      content:
        '주문한 지 일주일이 지났는데 아직 배송 시작도 안 됐어요. 언제쯤 받아볼 수 있을까요?',
    },
    {
      title: '사이즈 문의드립니다',
      content:
        '평소 270 신는데 이 제품은 정사이즈인가요? 한 치수 크게 주문해야 할지 고민이에요.',
    },
    {
      title: '재입고 예정 있나요?',
      content:
        '품절이라고 떠 있는데 재입고 예정이 있을까요? 급해서 그러는데 010-1234-5678 로 연락 주시면 감사하겠습니다.',
    },
    {
      title: '색상이 사진과 많이 다른가요?',
      content:
        '화면으로 보던 색이랑 실물 색 차이가 큰 편인지 궁금합니다. 구매 전에 확인하고 싶어요.',
    },
    {
      title: '교환 가능한지 문의해요',
      content:
        '받아보니 생각보다 작네요. 한 사이즈 큰 걸로 교환 가능한지, 배송비는 어떻게 되는지 알려주세요.',
    },
    {
      title: 'AS는 어떻게 받나요?',
      content:
        '사용 중에 부품 하나가 헐거워졌어요. AS 절차가 궁금합니다. 메일 hong.gildong@example.com 으로 회신 부탁드려요.',
    },
    {
      title: '구성품에 대해 질문이요',
      content: '본품 말고 같이 들어있는 액세서리가 어떤 것들인지 알 수 있을까요?',
    },
  ];

  /** 답변완료(answered)로 둘 Q&A 풀. */
  private static readonly ANSWERED: {
    title: string;
    content: string;
    answer: string;
  }[] = [
    {
      title: '오늘 주문하면 언제 도착하나요?',
      content: '지금 주문하면 출고가 언제 되고 며칠 안에 받을 수 있나요?',
      answer:
        '안녕하세요 고객님, 오후 3시 이전 주문은 당일 출고되어 보통 1~2일 내 수령 가능합니다. 감사합니다.',
    },
    {
      title: '사은품도 함께 오나요?',
      content: '본품 외에 사은품이 같이 동봉되는지 궁금합니다.',
      answer:
        '네 고객님, 현재 진행 중인 이벤트로 사은품이 함께 발송됩니다. 즐거운 쇼핑 되세요!',
    },
    {
      title: '대량 구매 할인 되나요?',
      content: '회사에서 단체로 구매하려는데 수량 할인이 가능한가요?',
      answer:
        '대량 구매는 별도 견적 상담이 필요합니다. 고객센터로 문의 주시면 자세히 안내해 드리겠습니다.',
    },
    {
      title: '세탁 방법 알려주세요',
      content: '이 소재는 물세탁 해도 되나요? 관리 방법이 궁금합니다.',
      answer:
        '찬물 손세탁 또는 세탁망 사용 후 그늘 건조를 권장드립니다. 건조기는 변형 우려가 있어 피해 주세요.',
    },
  ];

  /** 비밀문의(isSecret) 풀 — 어시스턴트는 본문/제목/답변을 제외하고 메타만 반환한다(D1). */
  private static readonly SECRET: {
    title: string;
    content: string;
    answer: string | null;
  }[] = [
    {
      title: '환불 계좌 변경 요청',
      content: '환불 받을 계좌를 변경하고 싶습니다. 어떻게 처리하면 되나요?',
      answer: null,
    },
    {
      title: '개인적인 문의입니다',
      content: '주문 내역 관련해 비공개로 확인하고 싶은 부분이 있습니다.',
      answer:
        '고객님, 확인 결과 정상 처리되었습니다. 추가 문의는 고객센터로 연락 주세요.',
    },
  ];

  /**
   * 소규모 문의를 생성한다(미답변/답변완료/비밀 혼합).
   * @param buyerUserIds 시드 buyer userId 풀(작성자, FK)
   * @param sellerIds    시드 seller id 풀(문의 대상 셀러, FK)
   */
  async seedInquiries(
    buyerUserIds: number[],
    sellerIds: number[],
  ): Promise<void> {
    if (buyerUserIds.length === 0 || sellerIds.length === 0) {
      console.log('  ⚠️  buyer/seller 가 없어 문의 시드를 건너뜁니다.');
      return;
    }

    // 멱등: 시드 buyer 의 문의가 이미 있으면 skip.
    const existing = await this.inquiryRepo.count({
      where: { userId: In(buyerUserIds) },
    });
    if (existing > 0) {
      console.log(`  ✓ 시드 문의 이미 존재(${existing}건) → 문의 시드 skip`);
      return;
    }

    const products = await this.productRepo.find({
      where: { status: ProductStatus.PUBLISHED },
      select: ['id'],
    });
    if (products.length === 0) {
      console.log('  ⚠️  published 상품이 없어 문의 시드를 건너뜁니다.');
      return;
    }
    const productIds = products.map((p) => p.id);

    const inquiries: InquiryEntity[] = [];

    const pickProduct = () => productIds[rand(0, productIds.length - 1)];
    const pickBuyer = () => buyerUserIds[rand(0, buyerUserIds.length - 1)];
    const pickSeller = () => sellerIds[rand(0, sellerIds.length - 1)];

    // 미답변(waiting) — 풀 전체 1회 + 약간 더(가중치: 미답변이 다수).
    for (const t of InquirySeedService.WAITING) {
      inquiries.push(
        this.inquiryRepo.create({
          userId: pickBuyer(),
          productId: pickProduct(),
          sellerId: pickSeller(),
          title: t.title,
          content: t.content,
          answer: null,
          answeredAt: null,
          isSecret: false,
          status: InquiryStatus.WAITING,
        }),
      );
    }

    // 답변완료(answered).
    for (const t of InquirySeedService.ANSWERED) {
      inquiries.push(
        this.inquiryRepo.create({
          userId: pickBuyer(),
          productId: pickProduct(),
          sellerId: pickSeller(),
          title: t.title,
          content: t.content,
          answer: t.answer,
          answeredAt: new Date(),
          isSecret: false,
          status: InquiryStatus.ANSWERED,
        }),
      );
    }

    // 비밀문의(isSecret) — 미답변/답변완료 섞어서.
    for (const t of InquirySeedService.SECRET) {
      const answered = t.answer !== null;
      inquiries.push(
        this.inquiryRepo.create({
          userId: pickBuyer(),
          productId: pickProduct(),
          sellerId: pickSeller(),
          title: t.title,
          content: t.content,
          answer: t.answer,
          answeredAt: answered ? new Date() : null,
          isSecret: true,
          status: answered ? InquiryStatus.ANSWERED : InquiryStatus.WAITING,
        }),
      );
    }

    await this.inquiryRepo.save(inquiries);

    const waiting = inquiries.filter(
      (i) => i.status === InquiryStatus.WAITING,
    ).length;
    const secret = inquiries.filter((i) => i.isSecret).length;
    console.log(
      `  ✓ 문의 ${inquiries.length}건 (미답변 ${waiting} / 답변완료 ${inquiries.length - waiting} / 비밀 ${secret})`,
    );
  }
}
