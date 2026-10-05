'use client'

import { isAxiosError } from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useState, useEffect } from 'react';
import { authStorage } from '../service/auth-storage';
import { getMe, logout as logoutApi, UserResponse } from '../service/auth';
import { getAuthChannel } from '../service/auth-channel';

interface AuthContextType {
  user: UserResponse | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isHydrated: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** 새 탭이 다른 탭의 토큰 응답을 기다리는 시간. 같은 브라우저 안의 메시지라 보통 수 ms 면 온다. */
const TAB_TOKEN_WAIT_MS = 300;

export default function AuthContextProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [isHydrated, setIsHydrated] = useState(false);
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
      channel.postMessage({ type: 'REQUEST_TOKEN' });
      // 답해 줄 탭이 없으면(정말 비로그인) 여기서 기다림을 끝낸다
      const timer = setTimeout(() => setIsAwaitingTabToken(false), TAB_TOKEN_WAIT_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, []);


  useEffect(() => {
  const channel = getAuthChannel();
  if (!channel) return;

  const onMessage = (event: MessageEvent) => {
    const { type, accessToken } = event.data ?? {};

    if (type === 'LOGIN') {
      // 다른 탭이 로그인했다. "로그인 유지"를 켰으면 localStorage 를 같이 보므로 다시 조회하면 되고,
      // 껐으면 이 탭에는 토큰이 없다 — 그 탭에게 토큰을 달라고 한다(답은 아래 TOKEN_RESPONSE 로 온다).
      if (!authStorage.getAccessToken() && !authStorage.isRememberMe()) {
        channel.postMessage({ type: 'REQUEST_TOKEN' });
      } else {
        queryClient.invalidateQueries({ queryKey: ['auth', 'user'] });
      }
    } else if (type === 'LOGOUT') {
      // 다른 탭이 로그아웃했다 — 이 탭에 따로 들고 있던 토큰도 버린다(이미 서버에서 끊긴 토큰이다)
      authStorage.dropTabToken();
      queryClient.invalidateQueries({ queryKey: ['auth', 'user'] });
    } else if (type === 'TOKEN_REFRESHED') {
      queryClient.invalidateQueries({ queryKey: ['auth', 'user'] });
    } else if (type === 'REQUEST_TOKEN') {
      // 다른 탭에서 토큰 요청 시 응답
      authStorage.respondWithToken();
    } else if (type === 'TOKEN_RESPONSE' && accessToken) {
      // 다른 탭으로부터 토큰 받음
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
      if(e.key === 'accessToken' || e.key === 'auth:persist') {
        queryClient.invalidateQueries({ queryKey: ['auth', 'user'] });
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [queryClient]);

  const logout = async () => {
    try {
      await logoutApi();
    } finally {
      authStorage.clearToken();
      queryClient.setQueryData(['auth', 'user'], null);
      queryClient.removeQueries({ queryKey: ['cart'] });
      // 계정에 묶인 캐시 — 남겨 두면 다음에 로그인한 사용자에게 앞사람의 찜·문의·프로필이 잠깐 보인다
      queryClient.removeQueries({ queryKey: ['wishlist'] });
      queryClient.removeQueries({ queryKey: ['inquiries'] });
      queryClient.removeQueries({ queryKey: ['user'] });
    }
  };

  const { data: user, isLoading } = useQuery({
    queryKey: ['auth', 'user'],
    queryFn: async () => {
      // 토큰이 없으면 API 요청하지 않고 null 반환
      const token = authStorage.getAccessToken();
      if (!token) {
        return null;
      }

      try {
        const response = await getMe();
        return response.data;
      } catch (error) {
        // 401/403: 토큰 만료 또는 권한 없음 → 비로그인으로 처리
        if (isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403)) {
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

  return (
    <AuthContext.Provider
      value={{
        user: user || null,
        isLoading: isLoading || isAwaitingTabToken,
        isAuthenticated: !!user,
        isHydrated,
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