import ProductForm from '../components/ProductForm';

/**
 * 셀러 상품 등록 (01-seller-core §1-A②).
 * POST /v1/products → draft/pending 생성 후 POST /v1/products/:id/images 로 이미지 업로드(2단계).
 * 관리자 승인(PATCH /v1/admin/products/:id/approve) 시 published 로 게시된다.
 */
export default function SellerProductNewPage() {
  return (
    <div className="flex justify-center py-4">
      <ProductForm />
    </div>
  );
}
