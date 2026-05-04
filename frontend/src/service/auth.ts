import { LoginRequest, LoginResponse, RegisterRequest, RegisterResponse, UserProfileResponse } from "@shopping-mall/shared";
import { authClient, publicClient } from "../lib/axios/axios-http-client";

export interface LogoutResponse {
    message: string;
}

export interface MessageResponse {
    message: string;
}

export type UserResponse = UserProfileResponse;

export async function login(data: LoginRequest) {
    return publicClient.post<LoginResponse>("/auth/login", data);
}

export async function register(data: RegisterRequest) {
    return publicClient.post<RegisterResponse>("/auth/register", data);
}

export async function verifyEmail(token: string) {
    return publicClient.get<LoginResponse>("/auth/verify-email", { params: { token } });
}

export async function resendVerificationEmail(email: string) {
    return publicClient.post<MessageResponse>("/auth/resend-verification", { email });
}

export async function getMe() {
    return authClient.get<UserResponse>("/auth/me");
}

// accessToken은 Authorization 헤더로, refreshToken은 쿠키로 자동 전송됨
export async function logout() {
    return authClient.post<LogoutResponse>("/auth/logout");
}

export async function demoLogin() {
    return publicClient.post<LoginResponse>("/auth/demo-login");
}