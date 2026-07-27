'use client';

import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ApprovalStatus, type AdminProduct } from '@shopping-mall/shared';
import { useAdminProductsQuery } from '../../../../../hooks/admin-product-query-options';
import {
  approvalStatusLabel,
  formatPrice,
  primaryImageUrl,
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
} from '../../components/table-ui';
import ProductActionModal, { type ProductAction } from './ProductActionModal';
import { DEFAULT_APPROVAL_STATUS } from './ProductFilters';

/**
 * 상품 목록 — URL 의 approvalStatus/page 를 읽어 GET /admin/products 조회.
 * 액션은 승인 대기 상품에만 노출한다(백엔드도 400 으로 막지만 화면에서 먼저 차단).
 */

const TAKE = 20;

export default function ProductTable() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [target, setTarget] = useState<{ action: ProductAction; product: AdminProduct } | null>(null);

  const pageParam = Number(sp.get('page'));
  const approvalParam = sp.get('approvalStatus') ?? DEFAULT_APPROVAL_STATUS;

  const { data, isLoading, isError } = useAdminProductsQuery({
    page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1,
    take: TAKE,
    approvalStatus: approvalParam === 'all' ? undefined : (approvalParam as ApprovalStatus),
  });

  const goPage = (page: number) => {
    const params = new URLSearchParams(sp.toString());
    params.set('page', String(page));
    router.push(`${pathname}?${params.toString()}`);
  };

  const rows = data?.data ?? [];

  return (
    <div style={cardStyle}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>등록일 (KST)</th>
            <th style={thStyle}>상품</th>
            <th style={thStyle}>셀러</th>
            <th style={thStyle}>가격 / 재고</th>
            <th style={thStyle}>상태</th>
            <th style={thStyle}>처리 내역</th>
            <th style={thStyle}>액션</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr>
              <td style={tdStyle} colSpan={7}>
                불러오는 중…
              </td>
            </tr>
          )}
          {isError && (
            <tr>
              <td style={{ ...tdStyle, color: '#dc2626' }} colSpan={7}>
                상품 목록을 불러오지 못했습니다.
              </td>
            </tr>
          )}
          {!isLoading && !isError && rows.length === 0 && (
            <tr>
              <td style={{ ...tdStyle, color: '#64748b' }} colSpan={7}>
                조건에 맞는 상품이 없습니다.
              </td>
            </tr>
          )}
          {rows.map((product) => {
            const actionable = product.approvalStatus === ApprovalStatus.PENDING;
            const thumbnail = primaryImageUrl(product);
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
                <td style={tdStyle}>
                  {product.seller ? (
                    <>
                      <div style={{ fontWeight: 600 }}>{product.seller.businessName}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                        {product.seller.representativeName}
                      </div>
                    </>
                  ) : (
                    // 시드 상품처럼 셀러가 없는 건이 실제로 있다(sellerId nullable).
                    <span style={{ color: '#94a3b8' }}>셀러 없음</span>
                  )}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <div>{formatPrice(product.price)}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    재고 {product.stockQuantity.toLocaleString('ko-KR')}
                  </div>
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <span style={approvalBadge(product.approvalStatus)}>
                    {approvalStatusLabel(product.approvalStatus)}
                  </span>
                  <div style={{ marginTop: '4px' }}>
                    <span style={BADGE_TONE.neutral}>{productStatusLabel(product.status)}</span>
                  </div>
                </td>
                <td style={{ ...tdStyle, maxWidth: '220px' }}>
                  {product.approvalStatus === ApprovalStatus.REJECTED && product.rejectionReason ? (
                    <span style={{ color: '#dc2626' }}>{product.rejectionReason}</span>
                  ) : product.approvalStatus === ApprovalStatus.APPROVED && product.approvedAt ? (
                    <span style={{ color: '#475569' }}>{formatDateShort(product.approvedAt)} 승인</span>
                  ) : (
                    <span style={{ color: '#cbd5e1' }}>—</span>
                  )}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {actionable ? (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        style={actionButton('#2563eb')}
                        onClick={() => setTarget({ action: 'approve', product })}
                      >
                        승인
                      </button>
                      <button
                        style={actionButton('#dc2626')}
                        onClick={() => setTarget({ action: 'reject', product })}
                      >
                        반려
                      </button>
                    </div>
                  ) : (
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>처리 완료</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <AdminPagination meta={data?.meta} onPageChange={goPage} />

      {target && (
        <ProductActionModal
          action={target.action}
          product={target.product}
          onClose={() => setTarget(null)}
        />
      )}
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
