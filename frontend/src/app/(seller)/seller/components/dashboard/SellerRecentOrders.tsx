'use client';

import {
  DASHBOARD_ORDER_TAKE,
  useRecentSellerOrdersQuery,
} from '../../../../../hooks/seller-dashboard-query-options';
import { formatAmount, orderStatusLabel } from '../../../../../service/seller-order';
import {
  formatDateShort,
  tableScrollStyle,
  tableStyle,
  tdStyle,
  thStyle,
} from '../../../../../components/console/table-ui';
import { orderBadge } from '../../orders/components/SellerOrderTable';
import { panelStyle, SectionHeader } from './dashboard-ui';

/**
 * 최근 주문 5건 — GET /seller/orders (상태 무관, 최신순). 일별 매출 그래프와 같은 응답의 앞 5건이다.
 * items 는 백엔드가 내 상품만 걸러 주므로 "내 매출"은 그 합이다(주문/배송 화면과 같은 계산).
 */
export default function SellerRecentOrders() {
  const { data, isLoading, isError } = useRecentSellerOrdersQuery();
  const rows = (data?.data ?? []).slice(0, DASHBOARD_ORDER_TAKE);

  return (
    <section style={{ ...panelStyle, overflow: 'hidden' }} aria-label="최근 주문">
      <SectionHeader title="최근 주문" href="/seller/orders?status=all" linkLabel="전체 보기" />
      {isLoading && <p style={messageStyle}>불러오는 중…</p>}
      {isError && <p style={{ ...messageStyle, color: '#dc2626' }}>주문 목록을 불러오지 못했습니다.</p>}
      {!isLoading && !isError && rows.length === 0 && (
        <p style={messageStyle}>아직 들어온 주문이 없습니다. 구매자가 내 상품을 주문하면 여기에 보입니다.</p>
      )}
      {rows.length > 0 && (
        <div style={tableScrollStyle}>
          <table style={{ ...tableStyle, minWidth: '560px' }}>
            <thead>
              <tr>
                <th style={thStyle}>주문일 (KST)</th>
                <th style={thStyle}>주문번호</th>
                <th style={thStyle}>내 상품</th>
                <th style={thStyle}>내 매출</th>
                <th style={thStyle}>상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => {
                const myAmount = order.items.reduce((sum, item) => sum + Number(item.subtotal), 0);
                return (
                  <tr key={order.id}>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#475569' }}>
                      {formatDateShort(order.createdAt)}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                      {order.orderNumber}
                    </td>
                    <td style={{ ...tdStyle, minWidth: '180px', maxWidth: '260px' }}>
                      {order.items.map((item) => (
                        <div key={item.id}>
                          {item.productName} <span style={{ color: '#94a3b8' }}>× {item.quantity}</span>
                        </div>
                      ))}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatAmount(myAmount)}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <span style={orderBadge(order.status)}>{orderStatusLabel(order.status)}</span>
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
