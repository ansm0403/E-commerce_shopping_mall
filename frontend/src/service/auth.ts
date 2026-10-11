import { authRevision, withSessionLock } from './auth-session';
import { authStorage } from './auth-storage';
import {
  beginLoggingOut,
  resetLoggingOutFlag,
} from '../lib/axios/axios-http-client';
import { clearAccountQueries } from '../lib/react-query/clear-account-queries';
import { getQueryClient } from '../lib/react-query/get-query-client';
import type { DemoRole, DemoOptions, DemoStatus } from '@shopping-mall/shared';
import {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  UserProfileResponse,
} from '@shopping-mall/shared';
import { authClient, publicClient } from '../lib/axios/axios-http-client';

export interface LogoutResponse {
  message: string;
}

export interface MessageResponse {
  message: string;
}

export type UserResponse = UserProfileResponse;

export async function login(data: LoginRequest) {
  return establishSession(
    () => publicClient.post<LoginResponse>('/auth/login', data),
    !!data.rememberMe
  );
}

export async function register(data: RegisterRequest) {
  return publicClient.post<RegisterResponse>('/auth/register', data);
}

export async function verifyEmail(token: string) {
  return establishSession(
    () =>
      publicClient.get<LoginResponse>('/auth/verify-email', {
        params: { token },
      }),
    false
  );
}

export async function resendVerificationEmail(email: string) {
  return publicClient.post<MessageResponse>('/auth/resend-verification', {
    email,
  });
}

export async function getMe(signal?: AbortSignal) {
  return authClient.get<UserResponse>('/auth/me', { signal });
}

let pendingLogoutToken: string | null = null;
let pendingLogoutRevision: string | null = null;
async function finishLogout(token: string | null) {
  try {
    if (token) {
      await publicClient.post('/auth/logout', undefined, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return;
    }
  } catch (error) {
    if ((error as { response?: { status?: number } }).response?.status !== 401)
      throw error;
  }
  // Retry after a reload also closes the remaining cookie session. Invalid refresh means it already ended.
  let refreshed;
  try {
    refreshed = await publicClient.post<LoginResponse>('/auth/refresh');
  } catch (error) {
    if ((error as { response?: { status?: number } }).response?.status === 401)
      return;
    throw error;
  }
  await publicClient.post('/auth/logout', undefined, {
    headers: { Authorization: `Bearer ${refreshed.data.accessToken}` },
  });
}
export async function logout() {
  return withSessionLock(async () => {
    if (
      !authStorage.isLogoutPending() ||
      pendingLogoutRevision !== authRevision()
    )
      pendingLogoutToken = null;
    pendingLogoutToken ||= authStorage.getAccessToken();
    authStorage.markLogoutPending(true);
    beginLoggingOut();
    try {
      await finishLogout(pendingLogoutToken);
      pendingLogoutToken = null;
      authStorage.markLogoutPending(false);
      return { data: { message: '로그아웃 되었습니다.' } };
    } finally {
      authStorage.clearToken();
      pendingLogoutRevision = authStorage.isLogoutPending()
        ? authRevision()
        : null;
      const client = getQueryClient();
      await clearAccountQueries(client);
      client.setQueryData(['auth', 'user'], null);
    }
  });
}
async function establishSession(
  request: () => ReturnType<typeof publicClient.post<LoginResponse>>,
  rememberMe: boolean
) {
  return withSessionLock(async () => {
    if (authStorage.isLogoutPending()) {
      await finishLogout(
        pendingLogoutRevision === authRevision() ? pendingLogoutToken : null
      );
      pendingLogoutToken = null;
      pendingLogoutRevision = null;
      authStorage.markLogoutPending(false);
    }
    // Another tab may have finished the pending logout and established a new
    // cookie session. Its shared pending flag and revision supersede our token.
    pendingLogoutToken = null;
    pendingLogoutRevision = null;
    await clearAccountQueries(getQueryClient());
    const response = await request();
    authStorage.setAccessToken(response.data.accessToken, rememberMe);
    resetLoggingOutFlag();
    getQueryClient().setQueryData(['auth', 'user'], response.data.user);
    return Object.assign(response, { authRevision: authRevision() });
  });
}
export async function demoLogin(role: DemoRole = 'admin') {
  return establishSession(
    () => publicClient.post<LoginResponse>('/auth/demo-login', { role }),
    false
  );
}
export function getDemoOptions() {
  return publicClient.get<DemoOptions>('/auth/demo-options');
}
export function getDemoStatus(signal?: AbortSignal) {
  return authClient.get<DemoStatus>('/auth/demo-status', { signal });
}
