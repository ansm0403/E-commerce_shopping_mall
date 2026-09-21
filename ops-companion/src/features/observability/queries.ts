/**
 * Release Health 쿼리 (설계 §6 · §5.5).
 *
 * 인시던트 목록(1분)보다 staleTime 을 길게 잡는다. 14일 집계 비율은 몇 분 사이에 의미 있게
 * 바뀌지 않고, 백엔드 Redis 캐시도 60초라 그보다 자주 당겨야 같은 값을 받는다.
 */
import { useQuery } from '@tanstack/react-query';
import { fetchReleaseHealth, type ReleaseHealth } from '../../lib/api';

export const releaseHealthKey = ['release-health'] as const;

export function useReleaseHealth() {
  return useQuery<ReleaseHealth>({
    queryKey: releaseHealthKey,
    queryFn: fetchReleaseHealth,
    staleTime: 5 * 60_000,
    // 이 카드는 보조 정보다. 실패해도 인시던트 목록은 그대로 보여야 하므로 조용히 접는다.
    retry: 1,
  });
}
