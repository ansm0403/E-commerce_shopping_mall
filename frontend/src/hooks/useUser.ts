'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChangePasswordRequest, UpdateProfileRequest } from '@shopping-mall/shared';
import { changePassword, updateMyProfile } from '@/service/user';
import { userKeys } from '@/lib/react-query/user-query-options';

/** 프로필 수정 → 프로필 캐시를 응답으로 채우고, 헤더 닉네임이 쓰는 `/auth/me` 도 다시 받는다 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateProfileRequest) => updateMyProfile(body).then((res) => res.data),
    onSuccess: (profile) => {
      queryClient.setQueryData(userKeys.me(), profile);
      queryClient.invalidateQueries({ queryKey: ['auth', 'user'] });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: ChangePasswordRequest) => changePassword(body).then((res) => res.data),
  });
}
