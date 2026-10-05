import { authClient } from '../lib/axios/axios-http-client';

/**
 * 찜 목록 항목 — 백엔드 WishlistItemResponseDto 와 1:1 (상품은 요약 필드만 온다).
 * 이미지 주소는 두 종류다: 외부 링크(`https://…`, 시드 상품) · 셀러가 올린 사진(`/uploads/…`, next.config rewrites 로 서빙).
 */
export interface WishlistItem {
  id: number;
  createdAt: string;
  updatedAt: string;
  productId: number;
  product: {
    id: number;
    name: string;
    price: number;
    status: string;
    brand: string;
    rating: number;
    /** 옛 백엔드 응답에는 없을 수 있다(배포 순서) — 쓰는 쪽에서 배열인지 확인한다 */
    images?: Array<{ url: string; isPrimary: boolean; sortOrder: number }>;
  } | null;
}

/** 대표 사진 주소 — 대표로 지정된 것, 없으면 순서가 가장 앞선 것. 사진이 없으면 null */
export function wishlistImageUrl(product: WishlistItem['product']): string | null {
  const images = Array.isArray(product?.images) ? product.images : [];
  if (images.length === 0) return null;
  const primary = images.find((img) => img.isPrimary);
  return (primary ?? [...images].sort((a, b) => a.sortOrder - b.sortOrder)[0]).url || null;
}

/** 백엔드 WishListService.getMyList 의 meta (공용 PageMeta 와 모양이 다르다 — totalPages) */
export interface WishlistPage {
  data: WishlistItem[];
  meta: { total: number; page: number; take: number; totalPages: number };
}

export type WishlistToggleResult = { action: 'added' | 'removed'; productId: number };

/**
 * 위시리스트 토글 (추가 ↔ 제거 자동 전환)
 * - 이미 찜한 상품이면 제거, 아니면 추가 (백엔드가 처리)
 * - response: { action: 'added' | 'removed', productId: number }
 * - authClient 사용: JWT 토큰 자동 첨부 (BUYER 권한 필요)
 */
export function toggleWishlist(productId: number) {
  return authClient.post<WishlistToggleResult>('/wishlist/toggle', { productId });
}

/** 내 찜 목록(최근 찜한 순, 페이지 기반) */
export function getWishlist({ page = 1, take = 12 }: { page?: number; take?: number } = {}) {
  return authClient.get<WishlistPage>('/wishlist', { params: { page, take } });
}

/** 내가 찜한 상품 id 전체 — 하트의 초기 상태용(상품마다 단건 조회하지 않는다) */
export function getWishlistIds() {
  return authClient.get<{ productIds: number[] }>('/wishlist/ids');
}

/** 전체 비우기 — ⚠ `DELETE /wishlist` 는 개별 삭제가 아니다. 한 건 빼기는 toggleWishlist */
export function clearWishlist() {
  return authClient.delete<{ message: string }>('/wishlist');
}
