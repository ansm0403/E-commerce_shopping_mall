import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CheckoutCompleteContent, { isPaidOrLater } from './CheckoutCompleteContent';
import { getOrderDetail } from '../../../../service/order';
import type { OrderResponse } from '../../../../model/order';

/**
 * 결제 완료 페이지 — "결제가 됐는가" 판정.
 *
 * 운영 실결제(2026-10-16)에서 결제가 성공했는데 "결제 완료 상태를 확인할 수 없습니다" 가 보였다.
 * 백엔드는 결제 확인 직후 order.paid 리스너로 상태를 preparing 으로 넘기고, 운영에선 PortOne 웹훅이 verify 보다
 * 먼저 와서 이 페이지가 열릴 땐 이미 preparing 이다. `status !== 'paid'` 만 보던 조건(3cf48c4)이 원인.
 */

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === 'orderNumber' ? 'ORD-20261016-TEST01' : null) }),
}));
jest.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, email: 'buyer@test.local', roles: ['buyer'] }, isHydrated: true, isLoading: false }),
}));
jest.mock('../../../../hooks/useRequireAuth', () => ({ useRequireAuth: () => undefined }));
jest.mock('../../../../service/order', () => ({ getOrderDetail: jest.fn() }));

const baseOrder = {
  id: 1,
  orderNumber: 'ORD-20261016-TEST01',
  userId: 1,
  totalAmount: 12000,
  shippingAddress: '서울시 테스트구 1',
  recipientName: '테스트',
  recipientPhone: '01000000000',
  memo: null,
  cancelledAt: null,
  cancellationReason: null,
  createdAt: '2026-10-16T00:00:00.000Z',
  items: [{ id: 1, productId: 1, productName: '테스트 상품', quantity: 1, price: 12000 }],
};

function renderWith(order: Partial<OrderResponse>) {
  jest.mocked(getOrderDetail).mockResolvedValue({ data: { ...baseOrder, ...order } } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CheckoutCompleteContent />
    </QueryClientProvider>,
  );
}

describe('CheckoutCompleteContent — 결제 완료 판정', () => {
  it('결제 직후 리스너가 preparing 으로 넘긴 주문도 "결제가 완료되었습니다" 로 보인다 (운영 회귀)', async () => {
    renderWith({ status: 'preparing', paidAt: '2026-10-16T00:00:05.000Z' });
    expect(await screen.findByText('결제가 완료되었습니다!')).toBeTruthy();
    expect(screen.getByText('ORD-20261016-TEST01')).toBeTruthy();
    expect(screen.queryByText('결제 완료 상태를 확인할 수 없습니다.')).toBeNull();
  });

  it('paid 상태(리스너 전)도 성공으로 보인다', async () => {
    renderWith({ status: 'paid', paidAt: '2026-10-16T00:00:05.000Z' });
    expect(await screen.findByText('결제가 완료되었습니다!')).toBeTruthy();
  });

  it('결제 대기(pending_payment, paidAt 없음) 주문번호로 들어오면 안내 문구와 주문 내역 버튼', async () => {
    renderWith({ status: 'pending_payment', paidAt: null });
    expect(await screen.findByText('결제 완료 상태를 확인할 수 없습니다.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '주문 내역에서 확인하기' })).toBeTruthy();
  });

  it('isPaidOrLater — 결제 이후 상태 전부 true, 결제 전·취소(미결제)는 false', () => {
    for (const status of ['paid', 'preparing', 'shipped', 'delivered', 'completed'] as const) {
      expect(isPaidOrLater({ status, paidAt: null })).toBe(true);
    }
    expect(isPaidOrLater({ status: 'pending_payment', paidAt: null })).toBe(false);
    expect(isPaidOrLater({ status: 'cancelled', paidAt: null })).toBe(false);
    expect(isPaidOrLater({ status: 'cancelled', paidAt: '2026-10-16T00:00:05.000Z' })).toBe(true); // 결제 뒤 취소 — 결제는 있었다
  });
});
