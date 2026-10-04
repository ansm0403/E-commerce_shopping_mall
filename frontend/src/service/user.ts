import { AxiosError } from 'axios';
import type {
  ChangePasswordRequest,
  UpdateProfileRequest,
  UserProfileResponse,
} from '@shopping-mall/shared';
import { authClient } from '../lib/axios/axios-http-client';

/** 내 프로필 — `/auth/me`(인증 상태용, AuthContext)와 별개의 조회다 */
export function getMyProfile() {
  return authClient.get<UserProfileResponse>('/users/me');
}

/** 프로필 수정 — 보낸 필드만 바뀐다. 데모 계정은 403 */
export function updateMyProfile(body: UpdateProfileRequest) {
  return authClient.patch<UserProfileResponse>('/users/me', body);
}

/** 비밀번호 변경 — 현재 비밀번호가 틀리면 400. 데모 계정은 403 */
export function changePassword(body: ChangePasswordRequest) {
  return authClient.patch<{ message: string }>('/users/me/password', body);
}

/** 서버 에러 → 화면 문구. 백엔드가 준 message 를 최대한 살린다. */
export function userErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const message = error.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join('\n');
  }
  return '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
}
