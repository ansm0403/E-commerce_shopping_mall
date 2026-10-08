'use client';

/**
 * [OPT-5] useDeferredValue — 필터/정렬 전환 시 UI freeze 방지
 *
 * 기존 문제:
 *   카테고리 탭 클릭 → URL 변경 → useProducts re-query → 렌더링 전체 블로킹
 *   정렬 옵션 변경 시 버튼이 즉각 반응하지 않는 느낌 발생
 *
 * 개선:
 *   useDeferredValue로 queryParam을 "지연된 값"으로 만들어
 *   탭/정렬 버튼의 UI 업데이트는 즉각 반응하고,
 *   실제 API fetch는 React가 idle할 때 실행되도록 우선순위를 낮춤
 *
 *   isPending (useTransition과 함께): 지연 중임을 시각적으로 표현
 *   → 그리드가 흐릿해져 "로딩 중"임을 알림 (CLS 없이)
 *
 * ─── 측정 방법 ───────────────────────────────────────────────
 * 도구: Chrome DevTools > Performance > INP (Interaction to Next Paint)
 * 측정 지표:
 *   INP (Interaction to Next Paint) — "좋음" 기준: 200ms 이하
 *   개선 전: 카테고리 클릭 → 전체 리렌더 완료까지 블로킹 → INP 높음
 *   개선 후: 클릭 → 탭 UI 즉각 반응 → 그리드는 별도 우선순위로 처리 → INP 낮음
 *
 * 측정 절차:
 *   1. DevTools > Performance > Settings(톱니바퀴) > CPU: 4x slowdown 설정
 *   2. 녹화 시작 → 카테고리 탭 클릭 → 녹화 종료
 *   3. "Interactions" 트랙에서 INP 이벤트 확인
 *   또는 DevTools > Console에서: new PerformanceObserver((list) => {
 *     for (const entry of list.getEntries()) console.log(entry.interactionId, entry.duration);
 *   }).observe({ type: 'event', buffered: true });
 */

import { useCallback, useDeferredValue, useTransition } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useProducts } from '@/hook/useProduct';
import { useCategories } from '@/hooks/useCategories';
import { PaginatedProducts } from '@/model/product';
import { SortBy, SortOrder } from '@/model/paginate-param';
import ProductCard, { ProductCardSkeleton } from '@/components/home/ProductCard';

const SORT_OPTIONS: { label: string; sortBy: SortBy; sortOrder: SortOrder }[] = [
  { label: '최신순', sortBy: 'createdAt', sortOrder: 'DESC' },
  { label: '인기순', sortBy: 'viewCount', sortOrder: 'DESC' },
  { label: '평점순', sortBy: 'rating', sortOrder: 'DESC' },
  { label: '낮은 가격순', sortBy: 'price', sortOrder: 'ASC' },
  { label: '높은 가격순', sortBy: 'price', sortOrder: 'DESC' },
];

const PAGE_SIZE = 20;
const SKELETON_COUNT = 20;

/** [OPT-4] page.tsx의 Suspense fallback으로 사용. 외부 export 필요 */
export function ProductGridSkeleton() {
  return (
    <div className="py-8">
      <div className="h-8 w-32 bg-secondary-200 animate-pulse rounded mb-6" />
      <div className="flex gap-2 mb-6 overflow-x-auto">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-9 w-16 bg-secondary-200 animate-pulse rounded-full flex-shrink-0" />
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-6">
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

function Pagination({
  page,
  lastPage,
  onPageChange,
}: {
  page: number;
  lastPage: number;
  onPageChange: (p: number) => void;
}) {
  if (lastPage <= 1) return null;

  const pages = Array.from({ length: Math.min(lastPage, 5) }, (_, i) => {
    const start = Math.max(1, Math.min(page - 2, lastPage - 4));
    return start + i;
  });

  return (
    <div className="flex items-center justify-center gap-1 mt-10">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page === 1}
        className="px-3 py-2 rounded text-sm text-secondary-600 hover:bg-secondary-50 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ‹
      </button>
      {pages.map((p) => (
        <button
          key={p}
          onClick={() => onPageChange(p)}
          className={`w-9 h-9 rounded text-sm font-medium transition-colors
            ${p === page
              ? 'bg-primary-600 text-white'
              : 'text-secondary-600 hover:bg-secondary-50'
            }`}
        >
          {p}
        </button>
      ))}
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page === lastPage}
        className="px-3 py-2 rounded text-sm text-secondary-600 hover:bg-secondary-50 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ›
      </button>
    </div>
  );
}

export default function ProductsClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // [OPT-5] useTransition: 라우터 업데이트를 낮은 우선순위로 처리
  const [isPending, startTransition] = useTransition();

  // URL에서 파라미터 읽기 — 비정상값(NaN, 유효하지 않은 enum) 방어
  const rawCategoryId = Number(searchParams.get('categoryId'));
  const rawSellerId = Number(searchParams.get('sellerId'));
  const ratedOnly = searchParams.get('rated') === 'true';
  const sellerId = Number.isInteger(rawSellerId) && rawSellerId > 0 ? rawSellerId : undefined;
  const categoryId =
    searchParams.get('categoryId') && Number.isInteger(rawCategoryId) && rawCategoryId > 0
      ? rawCategoryId
      : undefined;

  const VALID_SORT_BY: SortBy[] = ['id', 'createdAt', 'rating', 'price', 'viewCount'];
  const VALID_SORT_ORDER: SortOrder[] = ['ASC', 'DESC'];
  const rawSortBy = searchParams.get('sortBy') as SortBy;
  const rawSortOrder = searchParams.get('sortOrder') as SortOrder;
  const sortByParam: SortBy = VALID_SORT_BY.includes(rawSortBy) ? rawSortBy : 'createdAt';
  const sortOrderParam: SortOrder = VALID_SORT_ORDER.includes(rawSortOrder) ? rawSortOrder : 'DESC';

  const rawPage = Number(searchParams.get('page'));
  const pageParam = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawKeyword = searchParams.get('keyword');
  const keyword = rawKeyword && rawKeyword.trim() !== '' ? rawKeyword : undefined;

  // [OPT-5] useDeferredValue — 필터/정렬/페이지 파라미터를 "지연된 값"으로 래핑
  // React가 더 긴급한 상태 업데이트(탭 UI 반응)를 먼저 처리하고, 이 값은 그 다음에 업데이트
  // 결과: 카테고리 탭 버튼은 클릭 즉시 활성화 스타일로 바뀌고, 상품 그리드 fetch는 그 다음
  const deferredCategoryId = useDeferredValue(categoryId);
  const deferredSellerId = useDeferredValue(sellerId);
  const deferredRatedOnly = useDeferredValue(ratedOnly);
  const deferredSortBy = useDeferredValue(sortByParam);
  const deferredSortOrder = useDeferredValue(sortOrderParam);
  const deferredPage = useDeferredValue(pageParam);
  const deferredKeyword = useDeferredValue(keyword);

  // 현재 활성 정렬 인덱스 (즉각 반응을 위해 deferred 미사용)
  const activeSortIdx = SORT_OPTIONS.findIndex(
    (o) => o.sortBy === sortByParam && o.sortOrder === sortOrderParam
  );

  const { roots } = useCategories();

  const { data, isLoading, isError } = useProducts.Paginate({
    page: deferredPage,
    limit: PAGE_SIZE,
    sortBy: deferredSortBy,
    sortOrder: deferredSortOrder,
    categoryId: deferredCategoryId,
    sellerId: deferredSellerId,
    filter: deferredRatedOnly ? { rating: { gt: 0 } } : undefined,
    keyword: deferredKeyword,
  });

  const result = data?.data as PaginatedProducts | undefined;
  const products = Array.isArray(result?.data) ? result.data.filter(Boolean) : [];
  const meta = result?.meta;

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      // [OPT-5] startTransition으로 URL 업데이트를 낮은 우선순위로 처리
      // 탭/버튼 활성화 UI는 즉각 반응, 실제 라우팅은 transition으로 처리
      startTransition(() => {
        const params = new URLSearchParams(searchParams.toString());
        Object.entries(updates).forEach(([key, value]) => {
          if (value === undefined) {
            params.delete(key);
          } else {
            params.set(key, value);
          }
        });
        if (!('page' in updates)) {
          params.set('page', '1');
        }
        router.push(`${pathname}?${params.toString()}`);
      });
    },
    [router, pathname, searchParams]
  );

  const handleCategoryClick = (id?: number) => {
    updateParams({ categoryId: id?.toString() });
  };

  const handleSortChange = (idx: number) => {
    const opt = SORT_OPTIONS[idx];
    updateParams({ sortBy: opt.sortBy, sortOrder: opt.sortOrder });
  };

  const handlePageChange = (p: number) => {
    updateParams({ page: p.toString() });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const selectedRoot = roots.find((c) => c.id === categoryId || c.children.some((child) => child.id === categoryId));
  const selectedCategory = selectedRoot?.id === categoryId ? selectedRoot : selectedRoot?.children.find((c) => c.id === categoryId);

  return (
    <div className="py-8 sm:py-12">
      {/* 페이지 제목 */}
      <p className="mb-3 text-[10px] font-semibold tracking-[0.2em] text-primary-400">EXPLORE YOUR EVERYDAY</p>
      <h1 className="mb-3 text-3xl font-semibold tracking-[-0.04em] text-primary-600 sm:text-4xl">
        {keyword ? `“${keyword}” 검색 결과` : selectedCategory ? selectedCategory.name : sellerId ? '판매자의 상품' : '취향을 발견하는 시간'}
      </h1>
      <p className="mb-8 text-sm text-primary-400">{selectedCategory ? `${selectedCategory.name}에서 마음에 드는 상품을 찾아보세요.` : '일상에 어울리는 다음 아이템을 만나보세요.'}</p>

      {/* 카테고리 필터 탭 */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-2 mb-4">
        <button
          onClick={() => handleCategoryClick(undefined)}
          className={`px-4 py-2 text-sm font-medium rounded-full whitespace-nowrap transition-colors
            ${!categoryId
              ? 'bg-primary-600 text-white'
              : 'text-secondary-600 hover:text-primary-600 hover:bg-primary-50 border border-secondary-200'
            }`}
        >
          전체
        </button>
        {roots.map((cat) => (
          <button
            key={cat.id}
            onClick={() => handleCategoryClick(cat.id)}
            className={`px-4 py-2 text-sm font-medium rounded-full whitespace-nowrap transition-colors
              ${selectedRoot?.id === cat.id
                ? 'bg-primary-600 text-white'
                : 'text-secondary-600 hover:text-primary-600 hover:bg-primary-50 border border-secondary-200'
              }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {selectedRoot && selectedRoot.children.length > 0 && (
        <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto" aria-label={`${selectedRoot.name} 세부 카테고리`}>
          {[selectedRoot, ...selectedRoot.children].map((category) => (
            <button key={category.id} type="button" aria-pressed={categoryId === category.id} onClick={() => handleCategoryClick(category.id)} className={`shrink-0 rounded-lg px-3 py-2 text-xs transition-colors ${categoryId === category.id ? 'bg-[#e9eee4] font-semibold text-[#47583d]' : 'text-primary-400 hover:bg-primary-50'}`}>
              {category.id === selectedRoot.id ? '전체' : category.name}
            </button>
          ))}
        </div>
      )}

      {/* 정렬 + 결과 수 */}
      <div className="flex items-center justify-between gap-3 border-t border-primary-100 py-4 mb-2">
        <p aria-live="polite" className="text-xs text-primary-400 sm:text-sm">
          {meta ? `총 ${meta.total.toLocaleString()}개` : ''}
        </p>
        <select aria-label="상품 정렬" value={activeSortIdx === -1 ? 0 : activeSortIdx} onChange={(e) => handleSortChange(Number(e.target.value))} className="h-10 max-w-[150px] rounded-xl border border-primary-100 bg-white px-3 text-xs text-primary-600 sm:hidden">
          {SORT_OPTIONS.map((option, index) => <option key={option.label} value={index}>{option.label}</option>)}
        </select>
        <div className="hidden gap-1 sm:flex">
          {SORT_OPTIONS.map((opt, idx) => (
            <button
              key={idx}
              onClick={() => handleSortChange(idx)}
              className={`text-sm px-3 py-1.5 rounded transition-colors
                ${(activeSortIdx === -1 ? 0 : activeSortIdx) === idx
                  ? 'text-primary-600 font-semibold'
                  : 'text-secondary-500 hover:text-secondary-800'
                }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* [OPT-5] 전환 중 그리드 흐림 처리 — CLS 없이 로딩 상태 표현 */}
      <div className={`transition-opacity duration-200 ${isPending ? 'opacity-60' : 'opacity-100'}`}>
        {/* 상품 그리드 */}
        {isError ? (
          <div className="text-center py-20 text-secondary-400">
            상품을 불러오지 못했습니다.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-6 sm:gap-y-10">
              {isLoading
                ? Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                    <ProductCardSkeleton key={i} />
                  ))
                : products.length === 0
                  ? (
                    <div className="col-span-full text-center py-20 text-secondary-400">
                      상품이 없습니다.
                    </div>
                  )
                  : products.map((product) => (
                      <ProductCard key={product.id} product={product} />
                    ))}
            </div>

            {meta && (
              <Pagination
                page={meta.page}
                lastPage={meta.lastPage}
                onPageChange={handlePageChange}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
