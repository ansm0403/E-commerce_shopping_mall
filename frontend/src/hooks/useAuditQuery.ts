'use client';

import { useQuery, useQueries } from '@tanstack/react-query';
import {
  fetchAuditLogs,
  AuditLog,
  AuditLogsResponse,
  AuditLogQuery,
  ADMIN_ACTOR_ACTIONS,
} from '../service/admin-audit';
import { addDays, todayKst } from './useDateRange';

const NO_FOCUS_REFETCH = { refetchOnWindowFocus: false } as const;

/**
 * 포렌식 검색(§5-B) 목록 쿼리.
 * - queryKey 에 모든 필터를 넣어 URL 변경 시 자동 refetch.
 * - 종료일 보정: endDate 가 'YYYY-MM-DD' 면 그 날 전체를 포함하도록 다음날 00:00(KST) 직전까지.
 */
export function useAuditLogsQuery(query: AuditLogQuery) {
  return useQuery<AuditLogsResponse>({
    queryKey: [
      'audit',
      'list',
      query.page,
      query.take,
      query.userId,
      query.action,
      query.success,
      query.startDate,
      query.endDate,
      query.ipAddress,
    ],
    queryFn: async () => {
      const res = await fetchAuditLogs(withExclusiveEnd(query));
      return res.data;
    },
    staleTime: 30 * 1000,
    ...NO_FOCUS_REFETCH,
  });
}

/**
 * 트리아지(§5-A) 집계 — 기존 엔드포인트를 필터로 N번 호출(§4-3 옵션 a, 1차).
 * 요약 엔드포인트는 신설하지 않는다. 카드가 많아지면 후속 최적화.
 *
 * 3버킷:
 *  - 🔴 보안: FAILED_LOGIN / ACCOUNT_LOCKED count
 *  - 🟠 시스템 오류: success=false 중 보안(로그인실패·잠금) 제외 → count + 샘플
 *  - 🟡 관리자 행위: ADMIN_ACTOR_ACTIONS 별 count 합산 + 최근 목록
 */
export function useTriageQuery(periodDays = 30) {
  const today = todayKst();
  const startDate = addDays(today, -(periodDays - 1));
  // 종료일(오늘) 전체 포함 → 배타적 상한은 다음날.
  const endDate = addDays(today, 1);
  const base = { startDate, endDate } as const;

  const tq = (key: (string | number)[], q: AuditLogQuery) => ({
    queryKey: ['audit', 'triage', ...key, startDate, endDate],
    queryFn: async () => (await fetchAuditLogs(q)).data,
    staleTime: 60 * 1000,
    ...NO_FOCUS_REFETCH,
  });

  const results = useQueries({
    queries: [
      tq(['failed'], { ...base, action: 'FAILED_LOGIN', take: 1 }),
      tq(['locked'], { ...base, action: 'ACCOUNT_LOCKED', take: 1 }),
      tq(['systemfail'], { ...base, success: false, take: 50 }),
      ...ADMIN_ACTOR_ACTIONS.map((a) => tq(['admin', a], { ...base, action: a, take: 5 })),
    ],
  });

  const [failedR, lockedR, sysR, ...adminR] = results;

  const failed = failedR.data?.meta.total ?? 0;
  const locked = lockedR.data?.meta.total ?? 0;
  const allFail = sysR.data?.meta.total ?? 0;
  // 시스템 오류 = success=false 전체 − 보안(로그인 실패·잠금). 우리 데이터상 그 외 false 는
  // 결제검증/웹훅/정산/크론 실패뿐이라 이 차감이 정확하다.
  const systemCount = Math.max(0, allFail - failed - locked);
  const systemSamples: AuditLog[] = (sysR.data?.data ?? [])
    .filter((r) => r.action !== 'FAILED_LOGIN' && r.action !== 'ACCOUNT_LOCKED')
    .slice(0, 5);

  const adminCount = adminR.reduce((s, r) => s + (r.data?.meta.total ?? 0), 0);
  const adminRecent: AuditLog[] = adminR
    .flatMap((r) => r.data?.data ?? [])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);

  return {
    period: { startDate, endDate: today },
    security: { failed, locked },
    system: { count: systemCount, samples: systemSamples },
    admin: { count: adminCount, recent: adminRecent },
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
  };
}

/** endDate('YYYY-MM-DD')를 그 날 전체 포함하도록 배타적 다음날로 보정 */
function withExclusiveEnd(query: AuditLogQuery): AuditLogQuery {
  if (!query.endDate) return query;
  return { ...query, endDate: addDays(query.endDate, 1) };
}
