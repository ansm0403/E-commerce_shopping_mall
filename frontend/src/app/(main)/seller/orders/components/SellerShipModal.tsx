'use client';

import { useState } from 'react';
import type { Order } from '@shopping-mall/shared';
import {
  sellerOrderErrorMessage,
  useShipOrderMutation,
} from '../../../../../hooks/seller-order-query-options';
import { formatAmount } from '../../../../../service/seller-order';

/**
 * 운송장 입력 모달 — PATCH /seller/orders/:orderNumber/ship.
 * 성공하면 내 Shipment 가 SHIPPED 로 바뀌고, 모든 셀러가 출고를 마치면
 * 주문 전체가 SHIPPED 로 동기화된다(백엔드 트랜잭션).
 */
export default function SellerShipModal({
  order,
  onClose,
}: {
  order: Order;
  onClose: () => void;
}) {
  const shipMutation = useShipOrderMutation();
  const [trackingNumber, setTrackingNumber] = useState('');
  const [carrier, setCarrier] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const myAmount = order.items.reduce((sum, item) => sum + Number(item.subtotal), 0);

  const submit = async () => {
    setErrorMessage(null);
    if (!trackingNumber.trim() || !carrier.trim()) {
      setErrorMessage('택배사와 운송장 번호를 모두 입력해주세요.');
      return;
    }
    try {
      await shipMutation.mutateAsync({
        orderNumber: order.orderNumber,
        dto: { trackingNumber: trackingNumber.trim(), carrier: carrier.trim() },
      });
      onClose();
    } catch (error) {
      setErrorMessage(sellerOrderErrorMessage(error));
    }
  };

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>배송 처리 (운송장 입력)</h2>
        <dl style={dlStyle}>
          <dt style={dtStyle}>주문번호</dt>
          <dd style={ddStyle}>{order.orderNumber}</dd>
          <dt style={dtStyle}>수령인</dt>
          <dd style={ddStyle}>
            {order.recipientName} · {order.recipientPhone}
          </dd>
          <dt style={dtStyle}>배송지</dt>
          <dd style={ddStyle}>{order.shippingAddress}</dd>
          <dt style={dtStyle}>내 상품</dt>
          <dd style={ddStyle}>
            {order.items.map((item) => (
              <div key={item.id}>
                {item.productName} × {item.quantity}
              </div>
            ))}
            <div style={{ marginTop: '4px', fontWeight: 600 }}>{formatAmount(myAmount)}</div>
          </dd>
        </dl>

        <label style={labelStyle}>
          택배사
          <input
            style={inputStyle}
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            placeholder="예: CJ대한통운"
          />
        </label>
        <label style={labelStyle}>
          운송장 번호
          <input
            style={inputStyle}
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
            placeholder="예: 1234-5678-9012"
          />
        </label>

        {errorMessage && (
          <p style={{ margin: 0, fontSize: '13px', color: '#dc2626', whiteSpace: 'pre-line' }}>
            {errorMessage}
          </p>
        )}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button style={cancelBtnStyle} onClick={onClose} disabled={shipMutation.isPending}>
            닫기
          </button>
          <button style={submitBtnStyle} onClick={submit} disabled={shipMutation.isPending}>
            {shipMutation.isPending ? '처리 중…' : '출고 완료 (SHIPPED)'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────── 스타일 ───────────────────

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50,
};

const modalStyle: React.CSSProperties = {
  width: 'min(440px, calc(100vw - 32px))',
  background: '#ffffff',
  borderRadius: '12px',
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  boxShadow: '0 20px 45px rgba(15, 23, 42, 0.25)',
};

const dlStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '72px 1fr',
  rowGap: '6px',
  columnGap: '10px',
  margin: 0,
  fontSize: '13px',
};

const dtStyle: React.CSSProperties = { color: '#64748b' };
const ddStyle: React.CSSProperties = { margin: 0, color: '#0f172a' };

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '13px',
  fontWeight: 600,
  color: '#0f172a',
};

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: '8px',
  border: '1px solid #cbd5e1',
  fontSize: '13px',
  fontWeight: 400,
};

const cancelBtnStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  padding: '8px 14px',
  borderRadius: '8px',
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#475569',
  cursor: 'pointer',
};

const submitBtnStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  padding: '8px 14px',
  borderRadius: '8px',
  border: 'none',
  background: '#2563eb',
  color: '#ffffff',
  cursor: 'pointer',
};
