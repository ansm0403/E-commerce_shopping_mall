/**
 * [OPT-4] 상품 목록 페이지 — SSR prefetchQuery
 *
 * 이전 구조:
 *   RSC page.tsx → <Suspense fallback={null}><ProductsClient /></Suspense>
 *   문제: ProductsClient가 마운트된 후 useQuery 발동 → 네트워크 왕복 후 그리드 표시
 *         이 동안 사용자는 빈 화면(fallback=null)을 봄
 *
 * 개선 구조:
 *   async RSC page.tsx → searchParams를 읽어 → 서버에서 첫 페이지 데이터 prefetch
 *   → ProductsClient 마운트 시 캐시 히트 → 즉시 그리드 표시 (스켈레톤 불필요)
 *
 * ─── 측정 방법 ───────────────────────────────────────────────
 * 도구: Chrome DevTools > Performance, Lighthouse
 * 측정 지표:
 *   1. FCP (First Contentful Paint)
 *      Lighthouse > Performance → FCP 값
 *      개선 전: 스켈레톤이 FCP (의미 없는 콘텐츠)
 *      개선 후: 실제 상품 그리드가 FCP
 *
 *   2. 스켈레톤 → 실데이터 전환 시간
 *      DevTools > Performance > 녹화 시작 → 페이지 이동 → 녹화 종료
 *      "LCP candidate" 타임스탬프 확인
 *
 *   3. Network 탭
 *      개선 전: /api/products?... 요청이 클라이언트에서 발생
 *      개선 후: 해당 요청 없음 (dehydrated 캐시에서 바로 소비)
 *
 * ─── Suspense fallback 개선 ───────────────────────────────────
 * 이전: fallback={null} → 아무것도 없는 빈 화면
 * 이후: fallback={<ProductGridSkeleton />} → 의미있는 레이아웃 힌트
 *       (SSR prefetch 성공 시 스켈레톤 자체가 보이지 않음)
 */

import { Suspense } from 'react';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import MaxWidthContainer from '@/components/layout/MaxWidthContainer';
import ProductsClient, { ProductGridSkeleton } from './ProductsClient';
import { getQueryClient } from '@/lib/react-query/get-query-client';
import { serverGet } from '@/lib/server-api';
import { productsQueryOptions } from '@/lib/react-query/products-query-options';
import type { SortBy, SortOrder, PaginateParam } from '@/model/paginate-param';

const VALID_SORT_BY: SortBy[] = ['id', 'createdAt', 'rating', 'price', 'viewCount'];
const VALID_SORT_ORDER: SortOrder[] = ['ASC', 'DESC'];
const PAGE_SIZE = 20;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  // ProductsClient의 URL 파라미터 파싱 로직과 동일하게 맞춤 (캐시 키 일치 필수)
  const rawCategoryId = Number(sp['categoryId']);
  const categoryId =
    sp['categoryId'] && Number.isInteger(rawCategoryId) && rawCategoryId > 0
      ? rawCategoryId
      : undefined;

  const rawSortBy = sp['sortBy'] as SortBy;
  const rawSortOrder = sp['sortOrder'] as SortOrder;
  const sortBy: SortBy = VALID_SORT_BY.includes(rawSortBy) ? rawSortBy : 'createdAt';
  const sortOrder: SortOrder = VALID_SORT_ORDER.includes(rawSortOrder) ? rawSortOrder : 'DESC';

  const rawPage = Number(sp['page']);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawKeyword = sp['keyword'] as string | undefined;
  const keyword = rawKeyword && rawKeyword.trim() !== '' ? rawKeyword : undefined;

  const paginateParam: PaginateParam = {
    page,
    limit: PAGE_SIZE,
    sortBy,
    sortOrder,
    categoryId,
    keyword,
  };

  const qc = getQueryClient();

  try {
    await qc.prefetchQuery({
      queryKey: productsQueryOptions.paginate(paginateParam).queryKey,
      queryFn: async () => {
        const params = new URLSearchParams();
        params.append('page', String(page));
        params.append('take', String(PAGE_SIZE));
        if (sortBy) params.append('sortBy', sortBy);
        if (sortOrder) params.append('sortOrder', sortOrder);
        if (categoryId) params.append('categoryId', String(categoryId));
        if (keyword) params.append('keyword', keyword);
        return serverGet(`/products?${params.toString()}`, { revalidate: 60 });
      },
      staleTime: 60_000,
    });
  } catch {
    // 서버사이드 fetch 실패 시 클라이언트 fallback
  }

  return (
    <MaxWidthContainer>
      <HydrationBoundary state={dehydrate(qc)}>
        {/* SSR 성공 시 스켈레톤은 표시되지 않음. 실패/느린 경우에만 보임 */}
        <Suspense fallback={<ProductGridSkeleton />}>
          <ProductsClient />
        </Suspense>
      </HydrationBoundary>
    </MaxWidthContainer>
  );
}
