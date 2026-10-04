'use client';

import { InquiryStatus, type InquiryResponse } from '@shopping-mall/shared';

interface InquiryItemProps {
  inquiry: InquiryResponse;
  /** 제목 위에 붙는 줄(예: 내 문의 화면의 상품 링크) */
  header?: React.ReactNode;
  /** 우측 상단 액션(삭제 등) */
  action?: React.ReactNode;
}

// shared BaseModel 의 createdAt 은 Date 로 선언돼 있지만 JSON 응답에서는 ISO 문자열로 온다 — 둘 다 받는다.
const formatDate = (iso: string | Date) =>
  new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

export function InquiryStatusBadge({ status }: { status: InquiryStatus }) {
  const answered = status === InquiryStatus.ANSWERED;
  return (
    <span
      className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
        answered ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
      }`}
    >
      {answered ? '답변 완료' : '답변 대기'}
    </span>
  );
}

/** 문의 한 건 — 제목·작성자·날짜·상태·본문·판매자 답변. 상품 상세 탭과 내 문의 화면이 같이 쓴다. */
export default function InquiryItem({ inquiry, header, action }: InquiryItemProps) {
  return (
    <div className="py-4 border-b border-secondary-100 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {header && <div className="mb-1 text-xs text-secondary-500">{header}</div>}
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <InquiryStatusBadge status={inquiry.status} />
            <p className="text-sm font-semibold text-secondary-900 break-words">
              {inquiry.isSecret && (
                <span role="img" aria-label="비밀글" className="mr-1">
                  🔒
                </span>
              )}
              {inquiry.title}
            </p>
          </div>
          <p className="text-xs text-secondary-500">
            {inquiry.user?.nickName ?? '익명'} · {formatDate(inquiry.createdAt)}
          </p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {/* 남의 비밀글은 서버가 본문을 비워서 준다 — 그때는 제목("비밀 문의입니다.")만 보인다 */}
      {inquiry.content && (
        <p className="mt-3 text-sm text-secondary-700 leading-relaxed whitespace-pre-wrap break-words">
          {inquiry.content}
        </p>
      )}

      {inquiry.answer && (
        <div className="mt-3 rounded-lg bg-secondary-50 p-4">
          <p className="text-xs font-semibold text-secondary-700 mb-1">
            판매자 답변
            {inquiry.answeredAt && (
              <span className="ml-2 font-normal text-secondary-600">
                {formatDate(inquiry.answeredAt)}
              </span>
            )}
          </p>
          <p className="text-sm text-secondary-700 leading-relaxed whitespace-pre-wrap break-words">
            {inquiry.answer}
          </p>
        </div>
      )}
    </div>
  );
}
