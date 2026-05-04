/**
 * [OPT-2] RSC/CC 경계 재설계 — 상품 상세 페이지
 *
 * 이전 구조 (비교용):
 *   'use client' ← page.tsx 전체가 CC
 *   useParams() + useQuery() → 브라우저 마운트 후 네트워크 요청 발생
 *   결과: 빈 HTML → Hydration → fetch → 렌더링 (2번의 왕복)
 *
 * 개선 구조:
 *   RSC page.tsx → 서버에서 prefetchQuery → dehydrate → HydrationBoundary
 *   ProductDetailClient (CC) → useQuery → 캐시 히트 (추가 fetch 없음)
 *   결과: 서버에서 React Query 캐시 채움 → 클라이언트 즉시 렌더링
 *
 * [OPT-3] ISR (Incremental Static Regeneration)
 *   export const revalidate = 300 → 5분마다 백그라운드 정적 재생성
 *   Next.js fetch cache tag로 revalidateTag() 온디맨드 갱신 가능
 *
 * ─── 측정 방법 ───────────────────────────────────────────────
 * 도구: Chrome DevTools > Network, Lighthouse
 * 측정 지표:
 *   1. LCP (Largest Contentful Paint)
 *      DevTools > Lighthouse > Performance 탭 → LCP 값 기록
 *      개선 전: 클라이언트 fetch 완료 시점 (보통 1.5~3s)
 *      개선 후: Hydration 직후 (보통 0.5~1.2s)
 *
 *   2. TTFB (Time To First Byte)
 *      DevTools > Network > 상품 상세 페이지 요청 → "Waiting" 시간
 *      revalidate 덕에 두 번째 방문부터 Vercel 캐시 히트 (< 50ms)
 *
 *   3. 워터폴 제거 확인
 *      DevTools > Network > /products/:id 요청 타이밍
 *      개선 전: HTML 로드 → /api/products/:id fetch (직렬)
 *      개선 후: /api/products/:id 별도 요청 없음 (캐시에서 즉시)
 *
 * ─── 비교 방법 ───────────────────────────────────────────────
 * 개선 전 코드 확인: git show HEAD~N:frontend/src/app/(main)/products/[id]/page.tsx
 * Lighthouse throttling: "Slow 4G" 조건에서 LCP 수치 비교
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { notFound } from 'next/navigation';
import { getQueryClient } from '@/lib/react-query/get-query-client';
import { serverGet } from '@/lib/server-api';
import { productsQueryOptions } from '@/lib/react-query/products-query-options';
import ProductDetailClient from './ProductDetailClient';
import type { Product } from '@/model/product';

// ─── [OPT-3] ISR 설정 ────────────────────────────────────────
// 상품 가격·재고는 자주 바뀔 수 있으므로 5분이 상한.
// 재고 0 전환 등 즉시 반영이 필요한 경우: 백엔드에서 revalidateTag() 호출 (Route Handler 필요)
export const revalidate = 300;

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);

  if (isNaN(id) || id <= 0) {
    notFound();
  }

  const qc = getQueryClient();

  try {
    // ─── [OPT-2] 서버사이드 prefetchQuery ─────────────────────
    // queryKey가 productsQueryOptions.detail(id)와 동일해야
    // 클라이언트의 useQuery가 캐시 히트로 추가 fetch를 생략한다.
    await qc.prefetchQuery({
      queryKey: productsQueryOptions.detail(id).queryKey,
      // RSC에서는 axios(상대 URL) 대신 serverGet(절대 URL)을 사용
      queryFn: () =>
        serverGet<Product>(`/products/${id}`, {
          revalidate: 300,
          tags: [`product-${id}`],
        }),
      staleTime: 300_000,
    });
  } catch {
    // 서버사이드 fetch 실패 시: 클라이언트에서 fallback fetch가 자동으로 발생
    // 사용자 경험에는 영향 없음 (기존 동작으로 폴백)
  }

  return (
    // HydrationBoundary: 서버에서 채운 React Query 캐시를 직렬화해 HTML에 포함
    // 클라이언트는 이 캐시를 복원 후 useQuery가 즉시 데이터를 반환
    <HydrationBoundary state={dehydrate(qc)}>
      <ProductDetailClient productId={id} />
    </HydrationBoundary>
  );
}
