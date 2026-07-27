'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { ShipmentStatus } from '@shopping-mall/shared';
import {
  adminOrderErrorMessage,
  useAdminOrderQuery,
  useDeliverOrderMutation,
} from '../../../../../hooks/admin-order-query-options';
import {
  formatAmount,
  orderStatusLabel,
  shipmentStatusLabel,
} from '../../../../../service/seller-order';
import {
  actionButton,
  BADGE_TONE,
  cardStyle,
  formatDateShort,
  tableStyle,
  tdStyle,
  thStyle,
} from '../../components/table-ui';
import { orderBadge } from '../components/OrderTable';

/**
 * 관리자 주문 상세 (02-admin-core §2-A③).
 * GET /v1/admin/orders/:orderNumber — items·shipments·payment 포함.
 * 배송완료 처리는 PATCH .../deliver — 배송건(셀러) 단위(sellerId 지정) 또는 전체(생략).
 * 모든 배송건이 DELIVERED 가 되면 주문도 DELIVERED 로 동기화된다(백엔드 트랜잭션).
 */
export default function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = use(params);
  const { data: order, isLoading, isError } = useAdminOrderQuery(orderNumber);
  const deliverMutation = useDeliverOrderMutation();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const deliver = async (sellerId?: number) => {
    setErrorMessage(null);
    try {
      await deliverMutation.mutateAsync({ orderNumber, sellerId });
    } catch (error) {
      setErrorMessage(adminOrderErrorMessage(error));
    }
  };

  if (isLoading) {
    return <p style={{ fontSize: '13px', color: '#64748b' }}>주문 정보를 불러오는 중…</p>;
  }
  if (isError || !order) {
    return (
      <div style={{ fontSize: '13px', color: '#64748b' }}>
        주문을 찾을 수 없습니다.{' '}
        <Link href="/admin/orders" style={{ color: '#2563eb', textDecoration: 'underline' }}>
          주문 목록으로
        </Link>
      </div>
    );
  }

  const shipments = order.shipments ?? [];
  const shippedCount = shipments.filter((s) => s.status === ShipmentStatus.SHIPPED).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <p style={{ margin: 0, fontSize: '13px' }}>
            <Link href="/admin/orders" style={{ color: '#2563eb', textDecoration: 'underline' }}>
              ← 주문 목록
            </Link>
          </p>
          <h1 style={{ margin: '6px 0 0', fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>
            주문 {order.orderNumber}
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            {formatDateShort(order.createdAt)} 주문 ·{' '}
            <span style={orderBadge(order.status)}>{orderStatusLabel(order.status)}</span>
          </p>
        </div>
        {shippedCount > 1 && (
          <button
            style={actionButton('#2563eb')}
            disabled={deliverMutation.isPending}
            onClick={() => deliver()}
          >
            배송 중 {shippedCount}건 모두 완료 처리
          </button>
        )}
      </header>

      {errorMessage && (
        <p
          style={{
            margin: 0,
            padding: '10px 12px',
            fontSize: '13px',
            color: '#dc2626',
            background: '#fef2f2',
            borderRadius: '8px',
            whiteSpace: 'pre-line',
          }}
        >
          {errorMessage}
        </p>
      )}

      {/* 수령/결제 정보 */}
      <section style={{ ...cardStyle, padding: '16px', display: 'flex', gap: '48px', flexWrap: 'wrap' }}>
        <dl style={dlStyle}>
          <dt style={dtStyle}>수령인</dt>
          <dd style={ddStyle}>{order.recipientName} · {order.recipientPhone}</dd>
          <dt style={dtStyle}>배송지</dt>
          <dd style={ddStyle}>{order.shippingAddress}</dd>
          <dt style={dtStyle}>배송 메모</dt>
          <dd style={ddStyle}>{order.memo ?? '—'}</dd>
        </dl>
        <dl style={dlStyle}>
          <dt style={dtStyle}>주문 금액</dt>
          <dd style={{ ...ddStyle, fontWeight: 700 }}>{formatAmount(order.totalAmount)}</dd>
          <dt style={dtStyle}>결제 상태</dt>
          <dd style={ddStyle}>
            <span style={order.payment?.status === 'paid' ? BADGE_TONE.approved : BADGE_TONE.neutral}>
              {order.payment?.status ?? '결제 정보 없음'}
            </span>
            {order.payment?.paymentMethod && <> · {order.payment.paymentMethod}</>}
          </dd>
          <dt style={dtStyle}>결제 일시</dt>
          <dd style={ddStyle}>{order.paidAt ? formatDateShort(order.paidAt) : '—'}</dd>
        </dl>
      </section>

      {/* 주문 상품 */}
      <section style={cardStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>상품</th>
              <th style={thStyle}>셀러 ID</th>
              <th style={thStyle}>단가</th>
              <th style={thStyle}>수량</th>
              <th style={thStyle}>소계</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id}>
                <td style={tdStyle}>{item.productName}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {item.sellerId ?? <span style={{ color: '#94a3b8' }}>셀러 없음(시드)</span>}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatAmount(item.productPrice)}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{item.quantity}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatAmount(item.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 배송건 (셀러 단위) */}
      <section style={cardStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>배송건 (셀러 ID)</th>
              <th style={thStyle}>상태</th>
              <th style={thStyle}>택배사 / 운송장</th>
              <th style={thStyle}>출고 / 배송완료</th>
              <th style={thStyle}>액션</th>
            </tr>
          </thead>
          <tbody>
            {shipments.length === 0 && (
              <tr>
                <td style={{ ...tdStyle, color: '#64748b' }} colSpan={5}>
                  배송건이 없습니다. (결제 완료 시점에 셀러별로 생성된다 — 셀러 없는 시드 상품만 담긴
                  주문은 배송건이 만들어지지 않는다)
                </td>
              </tr>
            )}
            {shipments.map((shipment) => (
              <tr key={shipment.id}>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>셀러 {shipment.sellerId}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <span style={shipmentBadge(shipment.status)}>
                    {shipmentStatusLabel(shipment.status)}
                  </span>
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {shipment.trackingNumber ? `${shipment.carrier} ${shipment.trackingNumber}` : '—'}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#475569' }}>
                  {shipment.shippedAt ? formatDateShort(shipment.shippedAt) : '—'}
                  {' / '}
                  {shipment.deliveredAt ? formatDateShort(shipment.deliveredAt) : '—'}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {shipment.status === ShipmentStatus.SHIPPED ? (
                    <button
                      style={actionButton('#16a34a')}
                      disabled={deliverMutation.isPending}
                      onClick={() => deliver(shipment.sellerId)}
                    >
                      배송완료 처리
                    </button>
                  ) : (
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                      {shipment.status === ShipmentStatus.PREPARING ? '셀러 출고 대기' : '완료'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function shipmentBadge(status: string): React.CSSProperties {
  if (status === ShipmentStatus.PREPARING) return BADGE_TONE.pending;
  if (status === ShipmentStatus.SHIPPED) return BADGE_TONE.neutral;
  return BADGE_TONE.approved;
}

const dlStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '84px 1fr',
  rowGap: '8px',
  columnGap: '12px',
  margin: 0,
  fontSize: '13px',
  minWidth: '280px',
};

const dtStyle: React.CSSProperties = { color: '#64748b' };
const ddStyle: React.CSSProperties = { margin: 0, color: '#0f172a' };
