'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { InquiryStatus, type InquiryResponse } from '@shopping-mall/shared';
import { inquiryQueryOptions } from '../../../../../lib/react-query/inquiry-query-options';
import {
  actionButton,
  AdminPagination,
  BADGE_TONE,
  cardStyle,
  formatDateShort,
  tableStyle,
  tdStyle,
  thStyle,
} from '../../../../../components/console/table-ui';
import SellerAnswerModal from './SellerAnswerModal';
import { parseInquiryTab } from './SellerInquiryFilters';

/**
 * 셀러 문의 목록 — GET /seller/inquiries?status=.
 * 내 상품에 달린 문의만 온다(백엔드가 sellerId 로 거른다). 비밀글도 셀러에게는 본문이 보인다.
 */

const TAKE = 20;

export default function SellerInquiryTable() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [target, setTarget] = useState<InquiryResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pageParam = Number(sp.get('page'));
  const tab = parseInquiryTab(sp.get('status'));

  const { data, isLoading, isError } = useQuery(
    inquiryQueryOptions.sellerInquiries(tab === 'all' ? 'all' : (tab as InquiryStatus), {
      page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1,
      take: TAKE,
    }),
  );

  const goPage = (page: number) => {
    const params = new URLSearchParams(sp.toString());
    params.set('page', String(page));
    router.push(`${pathname}?${params.toString()}`);
  };

  const rows = data?.data ?? [];

  return (
    <div style={cardStyle}>
      {/* 답변 등록 결과 — 화면 낭독기에도 알린다 */}
      <p role="status" style={{ margin: 0, padding: notice ? '10px 14px' : 0, fontSize: '13px', color: '#166534' }}>
        {notice}
      </p>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>작성일 (KST)</th>
            <th style={thStyle}>상품</th>
            <th style={thStyle}>제목</th>
            <th style={thStyle}>작성자</th>
            <th style={thStyle}>상태</th>
            <th style={thStyle}>액션</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr>
              <td style={tdStyle} colSpan={6}>불러오는 중…</td>
            </tr>
          )}
          {isError && (
            <tr>
              <td style={{ ...tdStyle, color: '#dc2626' }} colSpan={6}>
                문의 목록을 불러오지 못했습니다.
              </td>
            </tr>
          )}
          {!isLoading && !isError && rows.length === 0 && (
            <tr>
              <td style={{ ...tdStyle, color: '#64748b' }} colSpan={6}>
                {tab === 'waiting' ? '답변을 기다리는 문의가 없습니다.' : '조건에 맞는 문의가 없습니다.'}
              </td>
            </tr>
          )}
          {rows.map((inquiry) => {
            const answered = inquiry.status === InquiryStatus.ANSWERED;
            return (
              <tr key={inquiry.id}>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#475569' }}>
                  {formatDateShort(inquiry.createdAt)}
                </td>
                <td style={{ ...tdStyle, maxWidth: '220px' }}>
                  <Link href={`/products/${inquiry.productId}`} style={{ color: '#1d4ed8' }}>
                    {inquiry.product?.name ?? `상품 #${inquiry.productId}`}
                  </Link>
                </td>
                <td style={{ ...tdStyle, maxWidth: '280px' }}>
                  {inquiry.isSecret && (
                    <span role="img" aria-label="비밀글">
                      🔒{' '}
                    </span>
                  )}
                  {inquiry.title}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{inquiry.user?.nickName ?? '익명'}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <span style={answered ? BADGE_TONE.approved : BADGE_TONE.pending}>
                    {answered ? '답변 완료' : '미답변'}
                  </span>
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <button
                    style={actionButton(answered ? '#475569' : '#2563eb')}
                    onClick={() => {
                      setNotice(null);
                      setTarget(inquiry);
                    }}
                  >
                    {answered ? '답변 보기' : '답변하기'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <AdminPagination meta={data?.meta} onPageChange={goPage} />

      {target && (
        <SellerAnswerModal
          inquiry={target}
          onClose={() => setTarget(null)}
          onAnswered={() => {
            setTarget(null);
            setNotice('답변이 등록되었습니다.');
          }}
        />
      )}
    </div>
  );
}
