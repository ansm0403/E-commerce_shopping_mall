import { queryOptions } from '@tanstack/react-query';
import { getMyProfile } from '../../service/user';

/**
 * ⚠ AuthContext 의 `['auth','user']`(`/auth/me`, 인증 상태용)와 별개다.
 * 프로필을 고치면 둘 다 무효화한다 — 헤더의 닉네임은 `/auth/me` 쪽에서 온다(hooks/useUser.ts).
 */
export const userKeys = {
  all: ['user'] as const,
  me: () => [...userKeys.all, 'me'] as const,
};

export const userQueryOptions = {
  me: () =>
    queryOptions({
      queryKey: userKeys.me(),
      queryFn: () => getMyProfile().then((res) => res.data),
      staleTime: 1000 * 60,
    }),
};
