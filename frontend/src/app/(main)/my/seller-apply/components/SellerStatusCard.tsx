'use client';

import Link from 'next/link';
import { SellerStatus, type SellerApplication } from '@shopping-mall/shared';
import { useSellerRoleSync } from '../../../../../hooks/seller-query-options';

interface Props {
  application: SellerApplication;
  onReapply: () => void;
}

/**
 * 신청 이후 상태 뷰 — pending / approved / rejected 3분기.
 *
 * approved 일 때가 핵심이다. 승인은 DB 의 역할만 바꾸므로 손에 든 토큰은 아직 buyer 다
 * (00-role-audit §7-2). useSellerRoleSync 가 그 어긋남을 감지해 refresh 를 한 번 태우고,
 * 이 카드는 그 진행 상황을 사용자가 볼 수 있게 그대로 드러낸다 —
 * "승인됐다는데 셀러 페이지가 403" 이라는 상황을 만들지 않기 위해.
 */
export default function SellerStatusCard({ application, onReapply }: Props) {
  const isApproved = application.status === SellerStatus.APPROVED;
  const roleSync = useSellerRoleSync(isApproved);

  return (
    <div className="mx-auto mt-10 mb-10 flex w-full max-w-[560px] flex-col gap-5 rounded-xl border border-gray-200 bg-white p-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">셀러 신청 현황</h1>
          <StatusBadge status={application.status} />
        </div>
        <p className="text-[13px] text-gray-500">{statusDescription(application.status)}</p>
      </header>

      <dl className="flex flex-col gap-2 rounded-lg bg-gray-50 px-4 py-3 text-[13px]">
        <Row label="상호명" value={application.businessName} />
        <Row label="사업자번호" value={application.businessNumber} />
        <Row label="대표자" value={application.representativeName} />
        <Row label="사업장 주소" value={application.businessAddress} />
        <Row label="신청일" value={formatDate(application.createdAt)} />
        {application.approvedAt && <Row label="승인일" value={formatDate(application.approvedAt)} />}
      </dl>

      {application.status === SellerStatus.REJECTED && (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-[13px] font-semibold text-red-600">반려 사유</p>
            <p className="mt-1 text-[13px] whitespace-pre-line text-red-600">
              {application.rejectionReason ?? '사유가 기록되지 않았습니다.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onReapply}
            className="rounded-[10px] bg-[#50acd6] px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            다시 신청하기
          </button>
        </div>
      )}

      {isApproved && <ApprovedPanel state={roleSync} />}
    </div>
  );
}

/** 승인됐을 때의 토큰 동기화 진행 상황 + 다음 행동 안내 */
function ApprovedPanel({ state }: { state: ReturnType<typeof useSellerRoleSync> }) {
  if (state === 'syncing' || state === 'idle') {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] text-blue-700">
        셀러 권한을 적용하는 중입니다…
      </div>
    );
  }

  if (state === 'failed') {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-[13px] text-amber-800">
          승인은 완료됐지만 이 브라우저의 로그인 정보에는 셀러 권한이 아직 반영되지 않았습니다.
          한 번 로그아웃한 뒤 다시 로그인하면 적용됩니다.
        </p>
        <Link
          href="/login"
          className="self-start rounded-md border border-amber-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-amber-800 hover:bg-amber-100"
        >
          다시 로그인하기
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
      <p className="text-[13px] text-green-700">
        셀러 권한이 적용되었습니다. 이제 상품을 등록하고 주문을 관리할 수 있습니다.
      </p>
      <div className="flex gap-2">
        <Link
          href="/seller/products/new"
          className="rounded-md bg-green-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-green-700"
        >
          상품 등록하러 가기
        </Link>
        <Link
          href="/seller"
          className="rounded-md border border-green-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-green-700 hover:bg-green-100"
        >
          셀러 홈
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-[84px] shrink-0 text-gray-500">{label}</dt>
      <dd className="m-0 font-medium text-gray-900">{value}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: SellerStatus }) {
  const style =
    status === SellerStatus.APPROVED
      ? 'bg-green-100 text-green-700'
      : status === SellerStatus.REJECTED
        ? 'bg-red-100 text-red-600'
        : 'bg-amber-100 text-amber-700';
  const label =
    status === SellerStatus.APPROVED ? '승인' : status === SellerStatus.REJECTED ? '반려' : '심사 중';

  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${style}`}>{label}</span>;
}

function statusDescription(status: SellerStatus): string {
  if (status === SellerStatus.APPROVED) return '신청이 승인되어 셀러로 활동할 수 있습니다.';
  if (status === SellerStatus.REJECTED) return '신청이 반려되었습니다. 사유를 확인하고 다시 신청할 수 있습니다.';
  return '관리자가 신청 내용을 검토하고 있습니다. 승인되면 이 화면에서 바로 확인할 수 있습니다.';
}

/** 'YYYY-MM-DD HH:mm' (KST) */
function formatDate(value: string | Date): string {
  return new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);
}
