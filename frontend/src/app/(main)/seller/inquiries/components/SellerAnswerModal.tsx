'use client';

import { useEffect, useRef, useState } from 'react';
import { InquiryStatus, type InquiryResponse } from '@shopping-mall/shared';
import { useAnswerInquiry } from '../../../../../hooks/useInquiry';
import { inquiryErrorMessage } from '../../../../../service/inquiry';
import { formatDateShort } from '../../../../(admin)/admin/components/table-ui';

/**
 * 문의 답변 모달 — PATCH /seller/inquiries/:id/answer.
 * 답변은 한 번만 가능하다(백엔드가 재답변을 400 으로 막고, 수정 API 는 없다) → 이미 답변된 문의는 읽기 전용.
 */
export default function SellerAnswerModal({
  inquiry,
  onClose,
  onAnswered,
}: {
  inquiry: InquiryResponse;
  onClose: () => void;
  onAnswered: () => void;
}) {
  const answerMutation = useAnswerInquiry();
  const [answer, setAnswer] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const isAnswered = inquiry.status === InquiryStatus.ANSWERED;

  // 열릴 때 포커스를 모달 안으로, Esc 로 닫기
  useEffect(() => {
    (textareaRef.current ?? closeRef.current)?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const submit = async () => {
    setErrorMessage(null);
    try {
      await answerMutation.mutateAsync({ id: inquiry.id, body: { answer: answer.trim() } });
      onAnswered();
    } catch (error) {
      setErrorMessage(inquiryErrorMessage(error));
    }
  };

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="seller-answer-title"
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="seller-answer-title" style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
          {isAnswered ? '문의 내용' : '문의 답변'}
        </h2>
        <dl style={dlStyle}>
          <dt style={dtStyle}>상품</dt>
          <dd style={ddStyle}>{inquiry.product?.name ?? `상품 #${inquiry.productId}`}</dd>
          <dt style={dtStyle}>작성자</dt>
          <dd style={ddStyle}>
            {inquiry.user?.nickName ?? '익명'} · {formatDateShort(inquiry.createdAt)}
          </dd>
          <dt style={dtStyle}>제목</dt>
          <dd style={{ ...ddStyle, fontWeight: 600 }}>
            {inquiry.isSecret && '🔒 '}
            {inquiry.title}
          </dd>
          <dt style={dtStyle}>내용</dt>
          <dd style={{ ...ddStyle, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {inquiry.content}
          </dd>
        </dl>

        {isAnswered ? (
          <div style={answerBoxStyle}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
              등록한 답변{inquiry.answeredAt && ` · ${formatDateShort(inquiry.answeredAt)}`}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{inquiry.answer}</div>
          </div>
        ) : (
          <label style={labelStyle}>
            답변
            <textarea
              ref={textareaRef}
              style={textareaStyle}
              rows={5}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="답변은 등록 후 수정할 수 없습니다."
            />
          </label>
        )}

        {errorMessage && (
          <p role="alert" style={{ margin: 0, fontSize: '13px', color: '#dc2626', whiteSpace: 'pre-line' }}>
            {errorMessage}
          </p>
        )}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button ref={closeRef} style={cancelBtnStyle} onClick={onClose} disabled={answerMutation.isPending}>
            닫기
          </button>
          {!isAnswered && (
            <button
              style={{ ...submitBtnStyle, opacity: answer.trim() ? 1 : 0.5 }}
              onClick={submit}
              disabled={!answer.trim() || answerMutation.isPending}
            >
              {answerMutation.isPending ? '등록 중…' : '답변 등록'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────── 스타일 (SellerShipModal 과 같은 모양) ───────────────────

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
  width: 'min(520px, calc(100vw - 32px))',
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto',
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
  gridTemplateColumns: '56px 1fr',
  rowGap: '6px',
  columnGap: '10px',
  margin: 0,
  fontSize: '13px',
};

const dtStyle: React.CSSProperties = { color: '#64748b' };
const ddStyle: React.CSSProperties = { margin: 0, color: '#0f172a' };

const answerBoxStyle: React.CSSProperties = {
  background: '#f1f5f9',
  borderRadius: '8px',
  padding: '12px',
  fontSize: '13px',
  color: '#0f172a',
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '13px',
  fontWeight: 600,
  color: '#0f172a',
};

const textareaStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: '8px',
  border: '1px solid #cbd5e1',
  fontSize: '13px',
  fontWeight: 400,
  resize: 'vertical',
  fontFamily: 'inherit',
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
