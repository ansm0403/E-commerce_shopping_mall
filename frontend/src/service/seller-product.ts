import type {
  AdminProductImage,
  CreateProductRequest,
  PaginatedResponse,
  SellerProduct,
  SellerProductQuery,
  SellerSettableStatus,
  UpdateProductRequest,
} from '@shopping-mall/shared';
import { authClient } from '../lib/axios/axios-http-client';

/**
 * 셀러 상품 등록/관리 (01-seller-core §1-A②).
 *   GET    /products/my            (SELLER) — 본인 상품 목록(모든 상태)
 *   GET    /products/my/:id        (SELLER) — 수정 화면용 단건(HIDDEN 도 보임)
 *   POST   /products               (SELLER) — draft/pending 으로 생성
 *   PATCH  /products/:id           (SELLER) — 내용 수정 = 재심사(PENDING 복귀, 반려 재제출 포함)
 *   PATCH  /products/:id/status    (SELLER) — 게시/숨김/단종 토글, 재심사 미발동
 *   DELETE /products/:id           (SELLER) — 판매 중이거나 주문 이력 있으면 400
 *   POST   /products/:id/images    (SELLER) — multipart, 5MB 제한
 *
 * 등록은 2단계다: POST /products 로 id 를 받은 뒤 이미지들을 :id/images 로 올린다.
 */

export type SellerProductsResponse = PaginatedResponse<SellerProduct>;

export async function fetchMyProducts(query: SellerProductQuery) {
  const params: Record<string, string | number> = {
    // page 를 빼면 백엔드가 커서 페이지네이션으로 분기한다(CommonService.paginate).
    page: query.page ?? 1,
    take: query.take ?? 20,
  };
  if (query.approvalStatus) params.approvalStatus = query.approvalStatus;
  if (query.status) params.status = query.status;
  return authClient.get<SellerProductsResponse>('/products/my', { params });
}

export async function fetchMyProduct(id: number) {
  return authClient.get<SellerProduct>(`/products/my/${id}`);
}

export async function createProduct(dto: CreateProductRequest) {
  return authClient.post<SellerProduct>('/products', dto);
}

export async function updateProduct(id: number, dto: UpdateProductRequest) {
  return authClient.patch<SellerProduct>(`/products/${id}`, dto);
}

export async function updateProductStatus(id: number, status: SellerSettableStatus) {
  return authClient.patch<SellerProduct>(`/products/${id}/status`, { status });
}

export async function deleteProduct(id: number) {
  return authClient.delete<void>(`/products/${id}`);
}

export async function uploadProductImage(productId: number, file: File) {
  const formData = new FormData();
  formData.append('file', file);
  return authClient.post<AdminProductImage>(`/products/${productId}/images`, formData, {
    // 인스턴스 기본 헤더가 'application/json' 으로 고정돼 있어(axios-http-client.ts)
    // undefined 로 지워야 브라우저가 multipart/form-data; boundary=... 를 붙인다.
    headers: { 'Content-Type': undefined },
  });
}

/** 여러 장을 순서대로 업로드 — 백엔드가 업로드 순서로 sortOrder/isPrimary(첫 장)를 정한다 */
export async function uploadProductImages(productId: number, files: File[]) {
  const uploaded: AdminProductImage[] = [];
  for (const file of files) {
    uploaded.push((await uploadProductImage(productId, file)).data);
  }
  return uploaded;
}
