/**
 * [OPT-6] staleTime 전략 — 데이터 특성에 맞는 캐시 유효 시간 설정
 *
 * staleTime이란?
 *   React Query가 캐시 데이터를 "신선"하다고 판단하는 시간.
 *   이 시간 안에는 동일 queryKey 요청이 와도 네트워크 요청 없이 캐시 반환.
 *
 * 쇼핑몰 상품 데이터 정책:
 *   - paginate(목록): 60초 — 상품 추가/변경이 즉각 반영될 필요는 없음
 *   - detail(상세): 300초 — ISR revalidate와 일치. 가격·재고 캐시 오염 방지는 ISR이 담당
 *   - all(전체): 비활성 (내부 전용, 사용 시 별도 staleTime 검토)
 *
 * ─── 측정 방법 ───────────────────────────────────────────────
 * 도구: Chrome DevTools > Network > 필터: Fetch/XHR
 * 측정 지표: 동일 페이지 재방문 시 /api/products?... 요청 유무
 *
 * 측정 절차:
 *   1. 상품 목록 진입 → Network에서 /api/products?... 요청 확인
 *   2. 60초 이내 동일 파라미터로 재진입 (뒤로가기 or 직접 이동)
 *   3. 개선 전: 매번 네트워크 요청 발생
 *   4. 개선 후: 네트워크 요청 없음 (캐시 반환)
 */

import { queryOptions } from "@tanstack/react-query";
import { getAllProducts, getPaginateProducts, getProductDetail } from "../../service/products";
import { PaginateParam } from "../../model/paginate-param";

export const productsQueryOptions = {
  all: () => queryOptions({
    queryKey: ["products"],
    queryFn: getAllProducts,
    // 전체 목록은 현재 사용 빈도 낮음 — 기본값(QueryClient default 60s) 사용
  }),

  paginate: (additionalKey: PaginateParam) => queryOptions({
    queryKey: [
      "paginate",
      "products",
      additionalKey.page,
      additionalKey.limit,
      additionalKey.sortBy,
      additionalKey.sortOrder,
      additionalKey.cursor,
      additionalKey.filter,
      additionalKey.categoryId,
      additionalKey.keyword,
    ],
    queryFn: () => getPaginateProducts(additionalKey),
    // 상품 목록: 60초 — 신상품/가격 변경 반영 vs 과도한 재요청 방지 균형
    staleTime: 60_000,
  }),

  detail: (id: number) => queryOptions({
    queryKey: ["products", "detail", id],
    queryFn: () => getProductDetail(id),
    // 상품 상세: 5분 — ISR revalidate(300s)와 일치.
    // 5분 이내 재방문 시 캐시 반환, 5분 후 백그라운드 refetch
    staleTime: 300_000,
  }),
};
