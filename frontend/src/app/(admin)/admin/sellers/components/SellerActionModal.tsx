'use client';

import { useState } from 'react';
import type { SellerApplicationWithUser } from '@shopping-mall/shared';
import { Modal, ModalFooter } from '../../../../../components/common';
import {
  sellerMutationErrorMessage,
  useApproveSellerMutation,
  useRejectSellerMutation,
} from '../../../../../hooks/admin-seller-query-options';

export type SellerAction = 'approve' | 'reject';

interface Props {
  action: SellerAction;
  application: SellerApplicationWithUser;
  onClose: () => void;
}

/**
 * 승인 확인 / 반려(사유 필수) 모달.
 * - 승인: 백엔드가 seller.status 변경 + SELLER 역할 부여를 한 트랜잭션으로 처리한다.
 * - 반려: reason 이 빈 문자열이면 백엔드 400 이므로 프론트에서도 먼저 막는다.
 * - 403(DemoAccountGuard)은 모달 안에 인라인으로 띄운다 — 승인/반려에만 걸려 있어
 *   목록 조회는 되는데 액션만 막히는 상황을 화면에서 바로 이해할 수 있게.
 */
export default function SellerActionModal({ action, application, onClose }: Props) {
  const [reason, setReason] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const approveMutation = useApproveSellerMutation();
  const rejectMutation = useRejectSellerMutation();
  const isPending = approveMutation.isPending || rejectMutation.isPending;

  const isReject = action === 'reject';
  const trimmedReason = reason.trim();

  const submit = () => {
    setErrorMessage(null);
    if (isReject) {
      if (!trimmedReason) {
        setErrorMessage('반려 사유를 입력해주세요.');
        return;
      }
      rejectMutation.mutate(
        { id: application.id, reason: trimmedReason },
        { onSuccess: onClose, onError: (e) => setErrorMessage(sellerMutationErrorMessage(e)) },
      );
      return;
    }
    approveMutation.mutate(application.id, {
      onSuccess: onClose,
      onError: (e) => setErrorMessage(sellerMutationErrorMessage(e)),
    });
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isReject ? '셀러 신청 반려' : '셀러 신청 승인'}
      closeOnOverlayClick={!isPending}
    >
      <dl style={summaryStyle}>
        <SummaryRow label="상호명" value={application.businessName} />
        <SummaryRow label="사업자번호" value={application.businessNumber} />
        <SummaryRow label="대표자" value={application.representativeName} />
        <SummaryRow
          label="신청자"
          value={`${application.user?.nickName ?? `user#${application.userId}`} (${
            application.user?.email ?? '-'
          })`}
        />
      </dl>

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
            placeholder="예: 사업자등록번호가 조회되지 않습니다."
            style={textareaStyle}
          />
          <p style={helperStyle}>
            반려 사유는 신청자에게 그대로 노출되고 감사 로그에도 기록된다. 재신청은 가능하다.
          </p>
        </div>
      ) : (
        <p style={{ ...helperStyle, marginTop: '16px' }}>
          승인하면 신청자에게 <strong>SELLER 역할이 즉시 부여</strong>된다. 다만 이미 발급된
          액세스 토큰에는 반영되지 않으므로, 신청자는 토큰 갱신(재로그인 또는 자동 refresh) 후에
          셀러 기능을 쓸 수 있다.
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
      <dt style={{ width: '76px', flexShrink: 0, color: '#64748b' }}>{label}</dt>
      <dd style={{ margin: 0, color: '#0f172a', fontWeight: 500 }}>{value}</dd>
    </div>
  );
}

const summaryStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  margin: 0,
  padding: '12px 14px',
  background: '#f8fafc',
  borderRadius: '8px',
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
