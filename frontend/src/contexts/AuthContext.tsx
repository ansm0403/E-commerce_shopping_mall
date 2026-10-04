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

export default function AuthContextProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [isHydrated, setIsHydrated] = useState(false);

  // 클라이언트에서만 토큰 확인
  useEffect(() => {
    setIsHydrated(true);

    // 새 탭이 열렸을 때 토큰이 없으면 다른 탭에 요청
    const token = authStorage.getAccessToken();
    const isRememberMe = authStorage.isRememberMe();

    if (!token && !isRememberMe) {
      // sessionStorage 모드이고 토큰이 없으면 다른 탭에 요청
      const channel = getAuthChannel();
      channel?.postMessage({ type: 'REQUEST_TOKEN' });
    }
  }, []);


  useEffect(() => {
  const channel = getAuthChannel();
  if (!channel) return;

  const onMessage = (event: MessageEvent) => {
    const { type, accessToken } = event.data ?? {};

    if (type === 'LOGIN' || type === 'LOGOUT' || type === 'TOKEN_REFRESHED') {
      queryClient.invalidateQueries({ queryKey: ['auth', 'user'] });
    } else if (type === 'REQUEST_TOKEN') {
      // 다른 탭에서 토큰 요청 시 응답
      authStorage.respondWithToken();
    } else if (type === 'TOKEN_RESPONSE' && accessToken) {
      // 다른 탭으로부터 토큰 받음
      authStorage.setTokenFromBroadcast(accessToken);
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
    enabled: isHydrated,
  });

  return (
    <AuthContext.Provider
      value={{
        user: user || null,
        isLoading,
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