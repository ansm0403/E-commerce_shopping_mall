'use client';
import { authRevision } from '../service/auth-session';
import { clearAccountQueries } from '../lib/react-query/clear-account-queries';

import { isAxiosError } from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { authStorage } from '../service/auth-storage';
import { getMe, logout as logoutApi, UserResponse } from '../service/auth';
import { getAuthChannel } from '../service/auth-channel';
import {
  beginLoggingOut,
  resetLoggingOutFlag,
} from '../lib/axios/axios-http-client';

interface AuthContextType {
  user: UserResponse | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isHydrated: boolean;
  logoutRedirect?: string | null;
  logout: (destination?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * 콘솔 가드(AdminGuard·SellerGuard)가 역할을 확인하려고 따로 들고 있는 `/auth/me` 캐시의 키.
 * 로그인한 계정이 바뀌면 반드시 비운다 — 남아 있으면 가드가 **앞 계정의 역할**로 판정해서,
 * 셀러로 쓰다가 관리자로 다시 로그인한 사람이 관리자 화면에서 홈으로 튕긴다(새로고침해야 풀렸다).
 */
export const ROLE_CHECK_QUERY_KEY = ['auth', 'me'] as const;

/** 새 탭이 다른 탭의 토큰 응답을 기다리는 시간. 같은 브라우저 안의 메시지라 보통 수 ms 면 온다. */
const TAB_TOKEN_WAIT_MS = 300;

export default function AuthContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const tokenRequestId = useRef<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [logoutRedirect, setLogoutRedirect] = useState<string | null>(null);
  // "로그인 유지"를 끄면 access 토큰은 탭마다 따로(sessionStorage)다. 새 탭은 다른 탭에게 토큰을 물어보는데,
  // 답이 오기 전에 "토큰 없음 = 비로그인"으로 확정하면 로그인한 사용자의 새 탭이 로그인 화면으로 튕긴다.
  // 그래서 답을 기다리는 짧은 동안은 인증 상태를 "확인 중"으로 둔다(isLoading 에 합쳐 내보낸다).
  const [isAwaitingTabToken, setIsAwaitingTabToken] = useState(false);

  // 클라이언트에서만 토큰 확인
  useEffect(() => {
    setIsHydrated(true);

    // 새 탭이 열렸을 때 토큰이 없으면 다른 탭에 요청
    const token = authStorage.getAccessToken();
    const isRememberMe = authStorage.isRememberMe();
    const channel = getAuthChannel();

    if (!token && !isRememberMe && channel) {
      // sessionStorage 모드이고 토큰이 없으면 다른 탭에 요청
      setIsAwaitingTabToken(true);
      tokenRequestId.current = crypto.randomUUID();
      channel.postMessage({
        type: 'REQUEST_TOKEN',
        revision: authRevision(),
        requestId: tokenRequestId.current,
      });
      // 답해 줄 탭이 없으면(정말 비로그인) 여기서 기다림을 끝낸다
      const timer = setTimeout(
        () => setIsAwaitingTabToken(false),
        TAB_TOKEN_WAIT_MS
      );
      return () => clearTimeout(timer);
    }
    return undefined;
  }, []);

  useEffect(() => {
    const channel = getAuthChannel();
    if (!channel) return;

    const onMessage = (event: MessageEvent) => {
      const { type, accessToken, revision, requestId } = event.data ?? {};
      if (revision !== authRevision()) return;
      if (type === 'LOGIN' || type === 'LOGOUT') {
        if (type === 'LOGIN') resetLoggingOutFlag();
        else beginLoggingOut();
        authStorage.dropTabToken();
        void clearAccountQueries(queryClient).then(() => {
          if (revision !== authRevision()) return;
          if (type === 'LOGIN' && !authStorage.isRememberMe()) {
            tokenRequestId.current = crypto.randomUUID();
            channel.postMessage({
              type: 'REQUEST_TOKEN',
              revision,
              requestId: tokenRequestId.current,
            });
          } else queryClient.invalidateQueries({ queryKey: ['auth', 'user'] });
        });
      } else if (type === 'TOKEN_REFRESHED') {
        if (!authStorage.isRememberMe()) {
          tokenRequestId.current = crypto.randomUUID();
          channel.postMessage({
            type: 'REQUEST_TOKEN',
            revision,
            requestId: tokenRequestId.current,
          });
        } else queryClient.invalidateQueries({ queryKey: ['auth', 'user'] });
      } else if (type === 'REQUEST_TOKEN')
        authStorage.respondWithToken(requestId);
      else if (
        type === 'TOKEN_RESPONSE' &&
        accessToken &&
        requestId === tokenRequestId.current
      ) {
        tokenRequestId.current = null;
        authStorage.setTokenFromBroadcast(accessToken);
        setIsAwaitingTabToken(false);
        queryClient.invalidateQueries({ queryKey: ['auth', 'user'] });
      }
    };

    channel.addEventListener('message', onMessage);
    return () => channel.removeEventListener('message', onMessage);
  }, [queryClient]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === 'accessToken' ||
        e.key === 'auth:persist' ||
        e.key === 'auth:revision'
      ) {
        if (e.key === 'auth:revision') {
          const revision = authRevision();
          void clearAccountQueries(queryClient).then(() => {
            if (revision === authRevision())
              void queryClient.invalidateQueries({
                queryKey: ['auth', 'user'],
              });
          });
        } else queryClient.invalidateQueries({ queryKey: ['auth', 'user'] });
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [queryClient]);

  const logout = async (destination?: string) => {
    setLogoutRedirect(destination ?? null);
    await logoutApi();
  };

  const { data: user, isLoading } = useQuery({
    queryKey: ['auth', 'user'],
    queryFn: async ({ signal }) => {
      // 토큰이 없으면 API 요청하지 않고 null 반환
      const token = authStorage.getAccessToken();
      if (!token) {
        return null;
      }

      try {
        const response = await getMe(signal);
        return response.data;
      } catch (error) {
        // 401/403: 토큰 만료 또는 권한 없음 → 비로그인으로 처리
        if (
          isAxiosError(error) &&
          (error.response?.status === 401 || error.response?.status === 403)
        ) {
          return null;
        }
        // 네트워크 오류, 500 등: React Query가 처리하도록 throw
        throw error;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
    // 다른 탭의 토큰을 기다리는 동안은 조회하지 않는다(토큰 없이 조회하면 "비로그인"이 캐시에 들어간다)
    enabled: isHydrated && !isAwaitingTabToken,
  });

  // 로그인·로그아웃 서비스와 다른 탭 이벤트가 계정 전환의 개인 캐시를 정리한다.
  // /auth/me 조회로 세션 만료가 확인된 경우도 개인 캐시를 정리한다.
  const userId = user?.id ?? null;
  const previousUserId = useRef<number | string | null>(null);
  useEffect(() => {
    const previous = previousUserId.current;
    previousUserId.current = userId;
    if (userId !== null) setLogoutRedirect(null);
    if (previous !== null && userId === null) {
      // Session expiry also clears private data. Never restore a captured user
      // after this asynchronous cleanup: another login may already have completed.
      void clearAccountQueries(queryClient);
    }
  }, [userId, queryClient]);

  return (
    <AuthContext.Provider
      value={{
        user: user || null,
        isLoading: isLoading || isAwaitingTabToken,
        isAuthenticated: !!user,
        isHydrated,
        logoutRedirect,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
