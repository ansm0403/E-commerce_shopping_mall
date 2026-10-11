'use client';

import { reconcileDemoCheckout } from '@/service/demo-checkout';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { cancelOrder, confirmOrder, testDeliverOrder } from '@/service/order';
import { verifyPayment, cancelPayment } from '@/service/payment';
import { orderKeys } from '@/lib/react-query/order-query-options';
import { cartKeys } from '@/lib/react-query/cart-query-options';
import { VerifyPaymentRequest, CancelPaymentRequest } from '@/model/order';

function handleOrderError(error: any) {
  const message = error?.response?.data?.message ?? '오류가 발생했습니다. 다시 시도해주세요.';
  alert(Array.isArray(message) ? message.join('\n') : message);
}

export function useTestDeliverOrder(orderNumber: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => testDeliverOrder(orderNumber),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orderKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['seller', 'orders'] }),
        queryClient.invalidateQueries({ queryKey: ['seller', 'dashboard'] }),
      ]);
    },
    onError: handleOrderError,
  });
}

/**
 * 결제 검증 (포트원 콜백 성공 후 호출)
 * 성공 시 장바구니 무효화 + 주문 상세로 이동
 */
export function useVerifyPayment() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (dto: VerifyPaymentRequest) => verifyPayment(dto),

    onSuccess: (_, { paymentId }) => {
      // 결제 성공 시 장바구니 무효화
      queryClient.invalidateQueries({ queryKey: cartKeys.all });
      // 주문 목록도 무효화
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
      router.push(`/checkout/complete?orderNumber=${paymentId}`);
    },

    onError: (error, { paymentId }) => {
      // PG 결제는 성공했으나 서버 검증 실패 → 주문 상세에서 상태 확인 유도
      handleOrderError(error);
      router.push(`/my/orders/${paymentId}`);
    },
  });
}

/**
 * 주문 취소 (PENDING_PAYMENT 상태만 가능)
 */
export function useCancelOrder(orderNumber: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => cancelOrder(orderNumber),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },

    onError: handleOrderError,
  });
}

/**
 * 결제 취소/환불 (PAID, PREPARING 상태만 가능)
 */
export function useCancelPayment(orderNumber: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CancelPaymentRequest) => cancelPayment(orderNumber, dto),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },

    onError: handleOrderError,
  });
}

/**
 * 구매 확정 (DELIVERED 상태만 가능)
 */
export function useConfirmOrder(orderNumber: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => confirmOrder(orderNumber),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
    },

    onError: handleOrderError,
  });
}

export function useReconcileDemoCheckout(orderNumber: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => reconcileDemoCheckout(orderNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
      queryClient.invalidateQueries({ queryKey: cartKeys.all });
    },
    onError: handleOrderError,
  });
}
