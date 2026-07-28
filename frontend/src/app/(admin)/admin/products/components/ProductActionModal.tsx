'use client';

import { useState } from 'react';
import type { AdminProduct } from '@shopping-mall/shared';
import { Modal, ModalFooter } from '../../../../../components/common';
import {
  productMutationErrorMessage,
  useApproveProductMutation,
  useRejectProductMutation,
} from '../../../../../hooks/admin-product-query-options';
import { formatPrice, primaryImageUrl } from '../../../../../service/admin-product';

export type ProductAction = 'approve' | 'reject';

interface Props {
  action: ProductAction;
  product: AdminProduct;
  onClose: () => void;
}

/**
 * 상품 승인 확인 / 반려(사유 필수) 모달.
 * - 백엔드가 PENDING 인 상품만 받는다(그 외 400) — 목록에서 액션 버튼을 감춰 먼저 막는다.
 * - 403(DemoAccountGuard)은 모달 안에 인라인으로 표시.
 */
export default function ProductActionModal({ action, product, onClose }: Props) {
  const [reason, setReason] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const approveMutation = useApproveProductMutation();
  const rejectMutation = useRejectProductMutation();
  const isPending = approveMutation.isPending || rejectMutation.isPending;

  const isReject = action === 'reject';
  const trimmedReason = reason.trim();
  const thumbnail = primaryImageUrl(product);

  const submit = () => {
    setErrorMessage(null);
    if (isReject) {
      if (!trimmedReason) {
        setErrorMessage('반려 사유를 입력해주세요.');
        return;
      }
      rejectMutation.mutate(
        { id: product.id, reason: trimmedReason },
        { onSuccess: onClose, onError: (e) => setErrorMessage(productMutationErrorMessage(e)) },
      );
      return;
    }
    approveMutation.mutate(product.id, {
      onSuccess: onClose,
      onError: (e) => setErrorMessage(productMutationErrorMessage(e)),
    });
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isReject ? '상품 반려' : '상품 승인'}
      closeOnOverlayClick={!isPending}
    >
      <div style={summaryStyle}>
        {thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" style={thumbStyle} />
        )}
        <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
          <SummaryRow label="상품명" value={product.name} />
          <SummaryRow label="브랜드" value={product.brand} />
          <SummaryRow label="가격" value={formatPrice(product.price)} />
          <SummaryRow
            label="셀러"
            value={product.seller?.businessName ?? `sellerId ${product.sellerId ?? '없음'}`}
          />
          <SummaryRow label="카테고리" value={product.category?.name ?? '미지정'} />
        </dl>
      </div>

      {isReject ? (
        <div style={{ marginTop: '16px' }}>
          <label htmlFor="reject-reason" style={labelStyle}>
            반려 사유 <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            placeholder="예: 상품 이미지가 실제 상품과 일치하지 않습니다."
            style={textareaStyle}
          />
          <p style={helperStyle}>
            사유는 감사 로그에 기록된다. ⚠ 현재 백엔드는 <strong>반려된 상품을 되살리는 경로가 없다</strong> —
            셀러가 수정해도 PENDING 으로 돌아가는 건 승인된 상품뿐이라, 반려는 사실상 최종 결정이다.
          </p>
        </div>
      ) : (
        <p style={{ ...helperStyle, marginTop: '16px' }}>
          승인하면 상품 캐시가 무효화되어 <strong>즉시 구매자 목록·상세에 노출</strong>된다.
          (셀러가 이후 상품을 수정하면 다시 승인 대기로 돌아온다)
        </p>
      )}

      {errorMessage && <p style={errorStyle}>{errorMessage}</p>}

      <ModalFooter className="-mx-6 -mb-5 mt-5">
        <button type="button" onClick={onClose} disabled={isPending} style={cancelButtonStyle(isPending)}>
          취소
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={isPending || (isReject && !trimmedReason)}
          style={submitButtonStyle(isReject, isPending || (isReject && !trimmedReason))}
        >
          {isPending ? '처리 중…' : isReject ? '반려' : '승인'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: '12px', fontSize: '13px' }}>
      <dt style={{ width: '64px', flexShrink: 0, color: '#64748b' }}>{label}</dt>
      <dd style={{ margin: 0, color: '#0f172a', fontWeight: 500 }}>{value}</dd>
    </div>
  );
}

const summaryStyle: React.CSSProperties = {
  display: 'flex',
  gap: '14px',
  padding: '12px 14px',
  background: '#f8fafc',
  borderRadius: '8px',
};

const thumbStyle: React.CSSProperties = {
  width: '72px',
  height: '72px',
  objectFit: 'cover',
  borderRadius: '6px',
  flexShrink: 0,
  background: '#e2e8f0',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  color: '#0f172a',
  marginBottom: '6px',
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  fontSize: '13px',
  padding: '8px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: '6px',
  color: '#0f172a',
  resize: 'vertical',
};

const helperStyle: React.CSSProperties = {
  margin: '8px 0 0',
  fontSize: '12px',
  color: '#64748b',
  lineHeight: 1.6,
};

const errorStyle: React.CSSProperties = {
  margin: '12px 0 0',
  padding: '8px 10px',
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: '6px',
  fontSize: '13px',
  color: '#dc2626',
};

const cancelButtonStyle = (disabled: boolean): React.CSSProperties => ({
  fontSize: '13px',
  fontWeight: 600,
  padding: '8px 16px',
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#475569',
  borderRadius: '6px',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.6 : 1,
});

const submitButtonStyle = (isReject: boolean, disabled: boolean): React.CSSProperties => ({
  fontSize: '13px',
  fontWeight: 600,
  padding: '8px 16px',
  border: 'none',
  background: isReject ? '#dc2626' : '#2563eb',
  color: '#ffffff',
  borderRadius: '6px',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.6 : 1,
});
