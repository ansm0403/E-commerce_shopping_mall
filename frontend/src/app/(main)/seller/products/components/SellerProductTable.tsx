'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ApprovalStatus, ProductStatus, type SellerProduct } from '@shopping-mall/shared';
import {
  sellerProductErrorMessage,
  useDeleteProductMutation,
  useMyProductsQuery,
  useUpdateProductStatusMutation,
} from '../../../../../hooks/seller-product-query-options';
import {
  approvalStatusLabel,
  formatPrice,
  productStatusLabel,
} from '../../../../../service/admin-product';
import {
  actionButton,
  AdminPagination,
  BADGE_TONE,
  cardStyle,
  formatDateShort,
  tableStyle,
  tdStyle,
  thStyle,
} from '../../../../(admin)/admin/components/table-ui';
import { DEFAULT_APPROVAL_STATUS } from './SellerProductFilters';

/**
 * 셀러 본인 상품 목록 — URL 의 approvalStatus/page 로 GET /products/my 조회.
 *
 * 행별 액션 규칙:
 *   수정      : 항상 가능. 내용 수정은 재심사(PENDING 복귀) — 반려 상품의 재제출 경로이기도 하다.
 *   게시/숨김 : 승인(APPROVED)된 상품만. 재심사를 발동하지 않는 별도 API(:id/status).
 *   삭제      : 판매 중(published)이거나 주문 이력이 있으면 백엔드가 400 으로 막는다.
 */

const TAKE = 20;

export default function SellerProductTable() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pageParam = Number(sp.get('page'));
  const approvalParam = sp.get('approvalStatus') ?? DEFAULT_APPROVAL_STATUS;

  const { data, isLoading, isError } = useMyProductsQuery({
    page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1,
    take: TAKE,
    approvalStatus:
      approvalParam === 'all' ? undefined : (approvalParam as ApprovalStatus),
  });

  const statusMutation = useUpdateProductStatusMutation();
  const deleteMutation = useDeleteProductMutation();

  const goPage = (page: number) => {
    const params = new URLSearchParams(sp.toString());
    params.set('page', String(page));
    router.push(`${pathname}?${params.toString()}`);
  };

  const toggleStatus = async (product: SellerProduct) => {
    setErrorMessage(null);
    const next =
      product.status === ProductStatus.PUBLISHED ? 'hidden' : 'published';
    try {
      await statusMutation.mutateAsync({ id: product.id, status: next });
    } catch (error) {
      setErrorMessage(sellerProductErrorMessage(error));
    }
  };

  const removeProduct = async (product: SellerProduct) => {
    setErrorMessage(null);
    if (!window.confirm(`'${product.name}' 상품을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await deleteMutation.mutateAsync(product.id);
    } catch (error) {
      setErrorMessage(sellerProductErrorMessage(error));
    }
  };

  const rows = data?.data ?? [];

  return (
    <div style={cardStyle}>
      {errorMessage && (
        <p
          style={{
            margin: 0,
            padding: '10px 12px',
            fontSize: '13px',
            color: '#dc2626',
            background: '#fef2f2',
            borderBottom: '1px solid #fee2e2',
            whiteSpace: 'pre-line',
          }}
        >
          {errorMessage}
        </p>
      )}
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>등록일 (KST)</th>
            <th style={thStyle}>상품</th>
            <th style={thStyle}>가격 / 재고</th>
            <th style={thStyle}>판매 상태</th>
            <th style={thStyle}>승인 상태</th>
            <th style={thStyle}>액션</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr>
              <td style={tdStyle} colSpan={6}>
                불러오는 중…
              </td>
            </tr>
          )}
          {isError && (
            <tr>
              <td style={{ ...tdStyle, color: '#dc2626' }} colSpan={6}>
                상품 목록을 불러오지 못했습니다.
              </td>
            </tr>
          )}
          {!isLoading && !isError && rows.length === 0 && (
            <tr>
              <td style={{ ...tdStyle, color: '#64748b' }} colSpan={6}>
                등록한 상품이 없습니다.{' '}
                <Link href="/seller/products/new" style={{ color: '#2563eb', textDecoration: 'underline' }}>
                  첫 상품을 등록해보세요.
                </Link>
              </td>
            </tr>
          )}
          {rows.map((product) => {
            const thumbnail =
              product.images?.find((img) => img.isPrimary)?.url ?? product.images?.[0]?.url ?? null;
            const canToggle = product.approvalStatus === ApprovalStatus.APPROVED;
            const isPublished = product.status === ProductStatus.PUBLISHED;
            return (
              <tr key={product.id}>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#475569' }}>
                  {formatDateShort(product.createdAt)}
                </td>
                <td style={{ ...tdStyle, maxWidth: '280px' }}>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    {thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbnail} alt="" style={thumbStyle} />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{product.name}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>{product.brand}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                        {product.category?.name ?? '카테고리 미지정'}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <div>{formatPrice(product.price)}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    재고 {product.stockQuantity.toLocaleString('ko-KR')}
                  </div>
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <span style={isPublished ? BADGE_TONE.approved : BADGE_TONE.neutral}>
                    {productStatusLabel(product.status)}
                  </span>
                </td>
                <td style={{ ...tdStyle, maxWidth: '220px' }}>
                  <span style={approvalBadge(product.approvalStatus)}>
                    {approvalStatusLabel(product.approvalStatus)}
                  </span>
                  {product.approvalStatus === ApprovalStatus.REJECTED && product.rejectionReason && (
                    <div style={{ marginTop: '4px', fontSize: '12px', color: '#dc2626' }}>
                      {product.rejectionReason}
                    </div>
                  )}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <Link href={`/seller/products/${product.id}/edit`} style={actionButton('#475569')}>
                      수정
                    </Link>
                    {canToggle && (
                      <button
                        style={actionButton(isPublished ? '#b45309' : '#16a34a')}
                        disabled={statusMutation.isPending}
                        onClick={() => toggleStatus(product)}
                      >
                        {isPublished ? '숨김' : '게시'}
                      </button>
                    )}
                    <button
                      style={actionButton('#dc2626')}
                      disabled={deleteMutation.isPending}
                      onClick={() => removeProduct(product)}
                    >
                      삭제
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <AdminPagination meta={data?.meta} onPageChange={goPage} />
    </div>
  );
}

function approvalBadge(status: ApprovalStatus | string): React.CSSProperties {
  if (status === ApprovalStatus.APPROVED) return BADGE_TONE.approved;
  if (status === ApprovalStatus.REJECTED) return BADGE_TONE.rejected;
  return BADGE_TONE.pending;
}

const thumbStyle: React.CSSProperties = {
  width: '44px',
  height: '44px',
  objectFit: 'cover',
  borderRadius: '6px',
  flexShrink: 0,
  background: '#e2e8f0',
};
