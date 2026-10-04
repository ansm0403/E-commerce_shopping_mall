'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AnswerInquiryRequest, CreateInquiryRequest } from '@shopping-mall/shared';
import { answerInquiry, createInquiry, deleteInquiry } from '@/service/inquiry';
import { inquiryKeys } from '@/lib/react-query/inquiry-query-options';

/**
 * 문의 mutation 3종. 에러 표시는 호출한 화면이 한다(`inquiryErrorMessage`) — 폼 안에 문구로 보여 주기 위해
 * 여기서 alert 하지 않는다.
 */

/** 작성 → 그 상품의 문의 탭 + 내 문의 */
export function useCreateInquiry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateInquiryRequest) => createInquiry(body).then((res) => res.data),
    onSuccess: (inquiry) => {
      queryClient.invalidateQueries({ queryKey: inquiryKeys.productAll(inquiry.productId) });
      queryClient.invalidateQueries({ queryKey: inquiryKeys.mine() });
    },
  });
}

/** 삭제 → 내 문의 + 상품 문의 탭 */
export function useDeleteInquiry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => deleteInquiry(id).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inquiryKeys.mine() });
      queryClient.invalidateQueries({ queryKey: inquiryKeys.products() });
    },
  });
}

/** 답변 → 셀러 문의 목록(탭 3개 모두) + 상품 문의 탭 */
export function useAnswerInquiry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: AnswerInquiryRequest }) =>
      answerInquiry(id, body).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inquiryKeys.sellerAll() });
      queryClient.invalidateQueries({ queryKey: inquiryKeys.products() });
    },
  });
}
