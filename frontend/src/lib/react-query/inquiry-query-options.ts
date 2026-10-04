import { queryOptions, keepPreviousData } from '@tanstack/react-query';
import type { InquiryStatus } from '@shopping-mall/shared';
import {
  getMyInquiries,
  getProductInquiries,
  getSellerInquiries,
  type InquiryPageParams,
} from '../../service/inquiry';

/**
 * 문의 쿼리 키 — 구매자·셀러 화면이 한 계층(`['inquiries', …]`)을 공유한다.
 *
 * 무효화 규칙(hooks/useInquiry.ts):
 *   작성  → product(그 상품) · my
 *   삭제  → my · product(전체 — 어느 상품 탭에 떠 있었는지 모른다)
 *   답변  → seller · product(전체)
 * 구매자와 셀러는 다른 계정(다른 브라우저)이라 서로의 캐시는 건드릴 수 없다 — 상대 화면은 staleTime 뒤 재조회로 갱신된다.
 */
export const inquiryKeys = {
  all: ['inquiries'] as const,
  products: () => [...inquiryKeys.all, 'product'] as const,
  productAll: (productId: number) => [...inquiryKeys.products(), productId] as const,
  // auth 를 키에 넣는다 — 로그인 전후로 비밀글 마스킹이 달라지므로 같은 캐시를 쓰면 안 된다.
  product: (productId: number, params: InquiryPageParams, auth: boolean) =>
    [...inquiryKeys.productAll(productId), params, { auth }] as const,
  mine: () => [...inquiryKeys.all, 'my'] as const,
  my: (params: InquiryPageParams) => [...inquiryKeys.mine(), params] as const,
  sellerAll: () => [...inquiryKeys.all, 'seller'] as const,
  seller: (status: InquiryStatus | 'all', params: InquiryPageParams) =>
    [...inquiryKeys.sellerAll(), status, params] as const,
};

const STALE_TIME = 1000 * 30; // 30초 — 작성·답변 직후 다른 화면에서도 곧 보여야 한다

export const inquiryQueryOptions = {
  productInquiries: (productId: number, params: InquiryPageParams, auth: boolean) =>
    queryOptions({
      queryKey: inquiryKeys.product(productId, params, auth),
      queryFn: () => getProductInquiries(productId, params, { auth }).then((res) => res.data),
      staleTime: STALE_TIME,
      enabled: !!productId,
      // "더보기"는 take 를 키에 넣어 늘린다 → 새 키. 이전 목록을 유지해 깜빡임을 막는다.
      placeholderData: keepPreviousData,
    }),

  myInquiries: (params: InquiryPageParams) =>
    queryOptions({
      queryKey: inquiryKeys.my(params),
      queryFn: () => getMyInquiries(params).then((res) => res.data),
      staleTime: STALE_TIME,
      placeholderData: keepPreviousData,
    }),

  sellerInquiries: (status: InquiryStatus | 'all', params: InquiryPageParams) =>
    queryOptions({
      queryKey: inquiryKeys.seller(status, params),
      queryFn: () =>
        getSellerInquiries({ ...params, status: status === 'all' ? undefined : status }).then(
          (res) => res.data,
        ),
      staleTime: STALE_TIME,
      placeholderData: keepPreviousData,
    }),
};
