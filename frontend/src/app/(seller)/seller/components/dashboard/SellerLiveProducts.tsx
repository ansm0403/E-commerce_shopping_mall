'use client';

import Link from 'next/link';
import {
  DASHBOARD_PRODUCT_TAKE,
  useLiveProductsQuery,
} from '../../../../../hooks/seller-dashboard-query-options';
import { formatPrice } from '../../../../../service/admin-product';
import {
  actionButton,
  BADGE_TONE,
  tableScrollStyle,
  tableStyle,
  tdStyle,
  thStyle,
} from '../../../../../components/console/table-ui';
import { panelStyle, SectionHeader } from './dashboard-ui';

/**
 * 판매 중 상품(승인 + 게시) 최근 10개 — KPI "판매 중 상품"과 같은 응답을 쓴다.
 * 전부 상점에 보이는 상품이라 이름은 상점의 상품 화면으로 간다(수정은 오른쪽 버튼).
 */
export default function SellerLiveProducts() {
  const { data, isLoading, isError } = useLiveProductsQuery();
  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;

  return (
    <section style={{ ...panelStyle, overflow: 'hidden' }} aria-label="판매 중 상품">
      <SectionHeader
        title={total > DASHBOARD_PRODUCT_TAKE ? `판매 중 상품 (최근 ${DASHBOARD_PRODUCT_TAKE}개)` : '판매 중 상품'}
        href="/seller/products?approvalStatus=approved"
        linkLabel="전체 보기"
      />
      {isLoading && <p style={messageStyle}>불러오는 중…</p>}
      {isError && <p style={{ ...messageStyle, color: '#dc2626' }}>상품 목록을 불러오지 못했습니다.</p>}
      {!isLoading && !isError && rows.length === 0 && (
        <p style={messageStyle}>
          판매 중인 상품이 없습니다. 상품을 등록하면 관리자 승인 뒤 여기에 보입니다.{' '}
          <Link href="/seller/products/new" style={{ color: '#2563eb', textDecoration: 'underline' }}>
            상품 등록
          </Link>
        </p>
      )}
      {rows.length > 0 && (
        <div style={tableScrollStyle}>
          <table style={{ ...tableStyle, minWidth: '560px' }}>
            <thead>
              <tr>
                <th style={thStyle}>상품</th>
                <th style={thStyle}>가격</th>
                <th style={thStyle}>재고</th>
                <th style={thStyle}>누적 판매</th>
                <th style={thStyle}>관리</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((product) => {
                const thumbnail =
                  product.images?.find((img) => img.isPrimary)?.url ?? product.images?.[0]?.url ?? null;
                const soldOut = product.stockQuantity <= 0;
                return (
                  <tr key={product.id}>
                    <td style={{ ...tdStyle, maxWidth: '320px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {thumbnail && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumbnail} alt="" style={thumbStyle} />
                        )}
                        <Link
                          href={`/products/${product.id}`}
                          title="상점의 상품 화면 보기"
                          className="font-semibold text-slate-900 hover:text-blue-700 hover:underline"
                        >
                          {product.name}
                        </Link>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                      {formatPrice(product.price)}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                      {soldOut ? (
                        <span style={BADGE_TONE.rejected}>품절</span>
                      ) : (
                        `${product.stockQuantity.toLocaleString('ko-KR')}개`
                      )}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                      {(product.salesCount ?? 0).toLocaleString('ko-KR')}개
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                      <Link href={`/seller/products/${product.id}/edit`} style={actionButton('#475569')}>
                        수정
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const messageStyle: React.CSSProperties = {
  margin: 0,
  padding: '0 16px 16px',
  fontSize: '13px',
  color: '#64748b',
};

const thumbStyle: React.CSSProperties = {
  width: '36px',
  height: '36px',
  objectFit: 'cover',
  borderRadius: '6px',
  flexShrink: 0,
  background: '#e2e8f0',
};
