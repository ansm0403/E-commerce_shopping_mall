/**
 * AI 분석 쿼리 (설계 §5.5 queryKey `['analysis', incidentId]`).
 *
 * 화면 진입 = useQuery 로 POST(생성 또는 최근 결과). 첫 호출은 몇 초 걸리고 그 뒤는 백엔드 캐시(HIT)다.
 * "다시 분석" = useMutation 으로 POST { force: true } → 결과를 같은 queryKey 에 써 넣어 화면이 바로 바뀐다.
 *
 * 왜 조회와 재분석을 나누나: 조회는 실패하면 자동 재시도해도 되지만(캐시 HIT 는 공짜), 재분석은
 * LLM 을 부르는 비싼 동작이라 **사용자가 누를 때만** 한 번 나가야 한다. TanStack Query 에서 그 구분이
 * useQuery(자동·중복 제거) 와 useMutation(명시적 1회) 이다.
 */
import { AxiosError } from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requestAnalysis, type AnalyzeOptions, type IncidentAnalysis } from '../../lib/api';

export const analysisKey = (incidentId: string) => ['analysis', incidentId] as const;

/** 재시도해도 결과가 같은 상태코드. 404(없는 이슈)·503(LLM 미설정)·403·429(1분 상한) 는 곧바로 다시 물어도 같다 */
const NO_RETRY = new Set([403, 404, 429, 503]);

export function useAnalysis(incidentId: string) {
  return useQuery<IncidentAnalysis>({
    queryKey: analysisKey(incidentId),
    queryFn: () => requestAnalysis(incidentId),
    // 분석 결과는 백엔드 DB 에 고정된 값이다. 화면을 오가며 다시 당길 이유가 없다.
    staleTime: Infinity,
    retry: (failureCount, error) => {
      const status = (error as AxiosError)?.response?.status;
      return !(status && NO_RETRY.has(status)) && failureCount < 1;
    },
  });
}

export function useReanalyze(incidentId: string) {
  const queryClient = useQueryClient();
  return useMutation<IncidentAnalysis, AxiosError, AnalyzeOptions | undefined>({
    mutationFn: (options) => requestAnalysis(incidentId, { force: true, ...options }),
    onSuccess: (data) => {
      // 조회 쿼리를 다시 부르지 않고 결과를 직접 써 넣는다 — 다시 부르면 백엔드가 같은 행을 HIT 로 줄 뿐이라 왕복이 낭비다.
      queryClient.setQueryData(analysisKey(incidentId), data);
    },
  });
}
