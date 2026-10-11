import type { DemoRole } from '@shopping-mall/shared';
import { authRevision } from '../service/auth-session';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  login,
  logout,
  register,
  verifyEmail,
  resendVerificationEmail,
  demoLogin,
} from '../service/auth';
import type { LoginRequest, RegisterRequest } from '@shopping-mall/shared';
import { resetLoggingOutFlag } from '../lib/axios/axios-http-client';
import { ROLE_CHECK_QUERY_KEY } from '../contexts/AuthContext';

/**
 * 로그인 mutation hook
 */
export function useLoginMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['auth', 'login'],
    mutationFn: (data: LoginRequest) => login(data),
    onSuccess: (response) => {
      if (response.authRevision !== authRevision()) return;
      // 토큰 저장 전 isLoggingOut 플래그 리셋 (router.push 방식으로 전환해도 안전하게)
      resetLoggingOutFlag();

      // user 정보를 React Query 캐시에 저장
      queryClient.setQueryData(['auth', 'user'], response.data.user);
      // 앞 계정의 역할 캐시를 이동 전에 비운다(콘솔 가드가 그것으로 판정한다 — AuthContext 참고)
      queryClient.removeQueries({ queryKey: ROLE_CHECK_QUERY_KEY });
    },
  });
}

/**
 * 회원가입 mutation hook
 */
export function useRegisterMutation() {
  return useMutation({
    mutationKey: ['auth', 'register'],
    mutationFn: (data: RegisterRequest) => register(data),
  });
}

/**
 * 이메일 인증 mutation hook
 */
export function useVerifyEmailMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['auth', 'verify-email'],
    mutationFn: (token: string) => verifyEmail(token),
    onSuccess: (response) => {
      if (response.authRevision !== authRevision()) return;
      resetLoggingOutFlag();

      // 이메일 인증 후 자동 로그인 (rememberMe=false)

      queryClient.setQueryData(['auth', 'user'], response.data.user);
      // 앞 계정의 역할 캐시를 이동 전에 비운다(콘솔 가드가 그것으로 판정한다 — AuthContext 참고)
      queryClient.removeQueries({ queryKey: ROLE_CHECK_QUERY_KEY });
    },
  });
}

/**
 * 인증 메일 재발송 mutation hook
 */
export function useResendVerificationMutation() {
  return useMutation({
    mutationKey: ['auth', 'resend-verification'],
    mutationFn: (email: string) => resendVerificationEmail(email),
  });
}

export function useDemoLoginMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['auth', 'demo-login'],
    mutationFn: (role: DemoRole) => demoLogin(role),
    onSuccess: (response) => {
      if (response.authRevision !== authRevision()) return;
      resetLoggingOutFlag();

      queryClient.setQueryData(['auth', 'user'], response.data.user);
      // 앞 계정의 역할 캐시를 이동 전에 비운다(콘솔 가드가 그것으로 판정한다 — AuthContext 참고)
      queryClient.removeQueries({ queryKey: ROLE_CHECK_QUERY_KEY });
    },
  });
}

export function useLogoutMutation() {
  const router = useRouter();

  return useMutation({
    mutationKey: ['auth', 'logout'],
    mutationFn: () => logout(), // 서버에 로그아웃 요청: accessToken 블랙리스트 + refreshToken 쿠키 삭제
    onSuccess: () => {
      // logout() has already cleared the token and updated the observed user query.
      router.push('/login');
    },
    onError: () => {
      router.push('/login');
    },
  });
}
