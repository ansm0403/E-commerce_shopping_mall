'use client';

import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { OrderStatus } from '@shopping-mall/shared';
import { useAdminOrdersQuery } from '../../../../../hooks/admin-order-query-options';
import { formatAmount, orderStatusLabel } from '../../../../../service/seller-order';
import {
  AdminPagination,
  BADGE_TONE,
  cardStyle,
  formatDateShort,
  tableStyle,
  tdStyle,
  thStyle,
} from '../../components/table-ui';
import { DEFAULT_ORDER_STATUS } from './OrderFilters';

/**
 * 관리자 주문 목록 — GET /admin/orders. 행 클릭(주문번호)으로 상세 진입,
 * 배송완료 처리는 상세 화면에서 셀러(배송건) 단위로 한다.
 */

const TAKE = 20;

export default function OrderTable() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const pageParam = Number(sp.get('page'));
  const statusParam = sp.get('status') ?? DEFAULT_ORDER_STATUS;

  const { data, isLoading, isError } = useAdminOrdersQuery({
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
            <th style={thStyle}>수령인</th>
            <th style={thStyle}>상품</th>
            <th style={thStyle}>금액</th>
            <th style={thStyle}>결제</th>
            <th style={thStyle}>상태</th>
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
          {rows.map((order) => (
            <tr key={order.id}>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#475569' }}>
                {formatDateShort(order.createdAt)}
              </td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                <Link
                  href={`/admin/orders/${order.orderNumber}`}
                  style={{ color: '#2563eb', textDecoration: 'underline', fontFamily: 'monospace' }}
                >
                  {order.orderNumber}
                </Link>
              </td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{order.recipientName}</td>
              <td style={{ ...tdStyle, maxWidth: '260px' }}>
                {order.items[0]?.productName}
                {order.items.length > 1 && (
                  <span style={{ color: '#94a3b8' }}> 외 {order.items.length - 1}건</span>
                )}
              </td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatAmount(order.totalAmount)}</td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                <span style={order.payment?.status === 'paid' ? BADGE_TONE.approved : BADGE_TONE.neutral}>
                  {order.payment?.status ?? '-'}
                </span>
              </td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                <span style={orderBadge(order.status)}>{orderStatusLabel(order.status)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <AdminPagination meta={data?.meta} onPageChange={goPage} />
    </div>
  );
}

export function orderBadge(status: string): React.CSSProperties {
  if (status === OrderStatus.PREPARING || status === OrderStatus.PAID) return BADGE_TONE.pending;
  if (status === OrderStatus.SHIPPED) return BADGE_TONE.neutral;
  if (status === OrderStatus.DELIVERED || status === OrderStatus.COMPLETED) return BADGE_TONE.approved;
  if (status === OrderStatus.CANCELLED) return BADGE_TONE.rejected;
  return BADGE_TONE.neutral;
}
