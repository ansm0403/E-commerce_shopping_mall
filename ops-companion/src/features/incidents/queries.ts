/**
 * 인시던트 목록 쿼리 (설계 §5.5).
 *
 * 서버 데이터는 전부 TanStack Query 를 거친다. 직접 fetch 하지 않는다.
 * staleTime 은 목록의 실시간성을 고려해 1분 — 백엔드의 Redis 캐시 TTL 도 60초라
 * 그보다 자주 당겨봐야 같은 값을 받는다(설계 §3.2).
 */
import { useQuery } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { fetchIncident, fetchIncidents, type IncidentDetail, type IncidentSummary } from '../../lib/api';

export const incidentKeys = {
  all: ['incidents'] as const,
  detail: (id: string) => ['incident', id] as const,
};

export function useIncidents() {
  return useQuery<IncidentSummary[]>({
    queryKey: incidentKeys.all,
    queryFn: fetchIncidents,
    staleTime: 60_000,
    // 401 은 인터셉터가 refresh 로 처리하므로 쿼리 단계에서 반복 재시도할 이유가 없다.
    retry: 1,
  });
}

export function useIncident(id: string) {
  return useQuery<IncidentDetail>({
    queryKey: incidentKeys.detail(id),
    queryFn: () => fetchIncident(id),
    staleTime: 60_000,
    // 404(지워진 이슈를 가리키는 오래된 푸시)는 다시 물어도 404 다 — 재시도하지 않는다.
    retry: (failureCount, error) => (error as AxiosError)?.response?.status !== 404 && failureCount < 1,
  });
}
