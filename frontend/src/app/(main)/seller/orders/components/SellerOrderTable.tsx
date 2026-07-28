'use client';

import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { OrderStatus, ShipmentStatus, type Order } from '@shopping-mall/shared';
import {
  useSellerOrdersQuery,
} from '../../../../../hooks/seller-order-query-options';
import {
  formatAmount,
  orderStatusLabel,
  shipmentStatusLabel,
} from '../../../../../service/seller-order';
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
import SellerShipModal from './SellerShipModal';
import { DEFAULT_ORDER_STATUS } from './SellerOrderFilters';

/**
 * 셀러 주문 목록 — GET /seller/orders.
 * items·shipments 는 백엔드가 내 것만 걸러 준다(innerJoin/leftJoin 필터).
 * "배송 처리" 버튼은 내 shipment 가 PREPARING 일 때만 노출한다 —
 * shipment 는 결제 완료 시점에 생성되므로 결제 전 주문에는 버튼이 없다(정상).
 */

const TAKE = 20;

export default function SellerOrderTable() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [target, setTarget] = useState<Order | null>(null);

  const pageParam = Number(sp.get('page'));
  const statusParam = sp.get('status') ?? DEFAULT_ORDER_STATUS;

  const { data, isLoading, isError } = useSellerOrdersQuery({
    page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1,
    take: TAKE,
    status: statusParam === 'all' ? undefined : (statusParam as OrderStatus),
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
            <th style={thStyle}>주문일 (KST)</th>
            <th style={thStyle}>주문번호</th>
            <th style={thStyle}>수령인 / 배송지</th>
            <th style={thStyle}>내 상품</th>
            <th style={thStyle}>내 매출</th>
            <th style={thStyle}>상태</th>
            <th style={thStyle}>액션</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr>
              <td style={tdStyle} colSpan={7}>불러오는 중…</td>
            </tr>
          )}
          {isError && (
            <tr>
              <td style={{ ...tdStyle, color: '#dc2626' }} colSpan={7}>
                주문 목록을 불러오지 못했습니다.
              </td>
            </tr>
          )}
          {!isLoading && !isError && rows.length === 0 && (
            <tr>
              <td style={{ ...tdStyle, color: '#64748b' }} colSpan={7}>
                조건에 맞는 주문이 없습니다.
              </td>
            </tr>
          )}
          {rows.map((order) => {
            const myShipment = order.shipments?.[0] ?? null;
            const canShip = myShipment?.status === ShipmentStatus.PREPARING;
            const myAmount = order.items.reduce((sum, item) => sum + Number(item.subtotal), 0);
            return (
              <tr key={order.id}>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#475569' }}>
                  {formatDateShort(order.createdAt)}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                  {order.orderNumber}
                </td>
                <td style={{ ...tdStyle, maxWidth: '220px' }}>
                  <div style={{ fontWeight: 600 }}>{order.recipientName}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>{order.shippingAddress}</div>
                </td>
                <td style={{ ...tdStyle, maxWidth: '240px' }}>
                  {order.items.map((item) => (
                    <div key={item.id}>
                      {item.productName} <span style={{ color: '#94a3b8' }}>× {item.quantity}</span>
                    </div>
                  ))}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatAmount(myAmount)}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <span style={orderBadge(order.status)}>{orderStatusLabel(order.status)}</span>
                  {myShipment && (
                    <div style={{ marginTop: '4px', fontSize: '11px', color: '#64748b' }}>
                      내 배송: {shipmentStatusLabel(myShipment.status)}
                      {myShipment.trackingNumber && (
                        <> · {myShipment.carrier} {myShipment.trackingNumber}</>
                      )}
                    </div>
                  )}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {canShip ? (
                    <button style={actionButton('#2563eb')} onClick={() => setTarget(order)}>
                      배송 처리
                    </button>
                  ) : (
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <AdminPagination meta={data?.meta} onPageChange={goPage} />

      {target && <SellerShipModal order={target} onClose={() => setTarget(null)} />}
    </div>
  );
}

function orderBadge(status: string): React.CSSProperties {
  if (status === OrderStatus.PREPARING || status === OrderStatus.PAID) return BADGE_TONE.pending;
  if (status === OrderStatus.SHIPPED) return BADGE_TONE.neutral;
  if (status === OrderStatus.DELIVERED || status === OrderStatus.COMPLETED) return BADGE_TONE.approved;
  if (status === OrderStatus.CANCELLED) return BADGE_TONE.rejected;
  return BADGE_TONE.neutral;
}
