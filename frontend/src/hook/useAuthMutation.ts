import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { login, logout, register, verifyEmail, resendVerificationEmail, demoLogin } from "../service/auth";
import type { LoginRequest, RegisterRequest } from "@shopping-mall/shared";
import { authStorage } from "../service/auth-storage";
import { resetLoggingOutFlag } from "../lib/axios/axios-http-client";

/**
 * 로그인 mutation hook
 */
export function useLoginMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationKey: ["auth", "login"],
        mutationFn: (data: LoginRequest) => login(data),
        onSuccess: (response, variables) => {
            // 토큰 저장 전 isLoggingOut 플래그 리셋 (router.push 방식으로 전환해도 안전하게)
            resetLoggingOutFlag();

            authStorage.setAccessToken(response.data.accessToken, variables.rememberMe || false);

            // user 정보를 React Query 캐시에 저장
            queryClient.setQueryData(['auth', 'user'], response.data.user);
        }
    });
}

/**
 * 회원가입 mutation hook
 */
export function useRegisterMutation() {
    return useMutation({
        mutationKey: ["auth", "register"],
        mutationFn: (data: RegisterRequest) => register(data),
    });
}

/**
 * 이메일 인증 mutation hook
 */
export function useVerifyEmailMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationKey: ["auth", "verify-email"],
        mutationFn: (token: string) => verifyEmail(token),
        onSuccess: (response) => {
            resetLoggingOutFlag();

            // 이메일 인증 후 자동 로그인 (rememberMe=false)
            authStorage.setAccessToken(response.data.accessToken, false);

            queryClient.setQueryData(['auth', 'user'], response.data.user);
        },
    });
}

/**
 * 인증 메일 재발송 mutation hook
 */
export function useResendVerificationMutation() {
    return useMutation({
        mutationKey: ["auth", "resend-verification"],
        mutationFn: (email: string) => resendVerificationEmail(email),
    });
}

export function useDemoLoginMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationKey: ["auth", "demo-login"],
        mutationFn: () => demoLogin(),
        onSuccess: (response) => {
            resetLoggingOutFlag();
            authStorage.setAccessToken(response.data.accessToken, false);
            queryClient.setQueryData(['auth', 'user'], response.data.user);
        },
    });
}

export function useLogoutMutation() {
    const queryClient = useQueryClient();
    const router = useRouter();

    return useMutation({
        mutationKey: ["auth", "logout"],
        mutationFn: () => logout(), // 서버에 로그아웃 요청: accessToken 블랙리스트 + refreshToken 쿠키 삭제
        onSuccess: () => {
            // 1. localStorage / sessionStorage 클리어
            authStorage.clearToken();

            // 2. auth 관련 캐시만 제거 (상품/카테고리 등 무관한 캐시는 유지)
            queryClient.removeQueries({ queryKey: ['auth'] });

            // 3. 로그인 페이지로 리다이렉트
            router.push('/login');
        },
        onError: () => {
            // 서버 요청 실패해도 클라이언트 측은 정리
            authStorage.clearToken();
            queryClient.removeQueries({ queryKey: ['auth'] });
            router.push('/login');
        },
    });
}