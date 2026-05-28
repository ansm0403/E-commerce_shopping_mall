import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { authStorage } from '../../../src/service/auth-storage';

const baseConfig = {
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  timeout: 5000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // 쿠키를 자동으로 포함
};

// Refresh Token 관리를 위한 전역 상태
let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;
let isLoggingOut = false; // 로그아웃 처리 중 플래그
const MAX_RETRY_COUNT = 3;
const REFRESH_API_ENDPOINT = '/auth/refresh';

// 공개 API용 클라이언트 (인증 불필요)
export const publicClient = axios.create(baseConfig);

publicClient.interceptors.request.use(
  (config) => {
    console.log('[Public API] 요청 전 : ', config.url);
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 인증 필요 API용 클라이언트
export const authClient = axios.create(baseConfig);

authClient.interceptors.request.use(
  (config) => {
    // 로그아웃 처리 중이면 요청 차단
    if (isLoggingOut) {
      return Promise.reject(new Error('Logging out...'));
    }

    // localStorage와 sessionStorage 둘 다 확인
    const token = authStorage.getAccessToken();

    if (token) {
      config.headers = config.headers ?? {};
      config.headers.Authorization = `Bearer ${token}`;
    }

    console.log('[Auth API] 요청 전 : ', config.url);

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Refresh Token으로 새로운 Access Token을 발급받는다.
 *
 * [왜 이렇게 짰나 — 401 Race Condition 방지]
 * Access Token이 만료된 직후, 여러 API 요청이 거의 동시에 401을 받는다.
 * 각 요청이 독립적으로 /auth/refresh를 호출하면, Refresh Token "1회용 회전"
 * 정책과 충돌해 두 번째 이후 요청이 모두 실패 → 사용자가 강제 로그아웃된다.
 *
 * 해결: 모듈 전역에 isRefreshing 플래그 + 공유 refreshPromise를 둔다.
 *      첫 401 요청만 실제로 refresh를 호출하고, 동시에 들어온 다른 401들은
 *      "이미 진행 중인 같은 Promise"를 함께 기다리게 한다 (큐처럼 동기화).
 *
 * refreshToken은 httpOnly 쿠키에 저장되어 자동으로 전송됨.
 */
const refreshAccessToken = async (): Promise<string | null> => {
  // 이미 로그아웃 절차 중이면 더 이상 갱신 시도하지 않음 (무한 루프 방지)
  if (isLoggingOut) {
    return null;
  }

  // (1) 다른 요청이 이미 refresh 중이라면, 새로 호출하지 말고
  //     그 작업이 끝나길 같이 기다린다 → /auth/refresh는 단 1번만 나간다.
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  // (2) "내가 refresh를 시작했다" 표시 + 다른 요청들과 공유할 Promise 생성.
  isRefreshing = true;

  refreshPromise = (async () => {
    try {
      // refreshToken은 쿠키에 저장되어 있어 자동으로 전송됨 (withCredentials: true)
      const response = await publicClient.post(REFRESH_API_ENDPOINT);

      const { accessToken } = response.data;

      // localStorage 또는 sessionStorage에 저장 (기존에 저장된 위치에)
      authStorage.refreshAccessToken(accessToken);

      return accessToken;
    } catch {
      // 로그아웃 처리 중 플래그 설정 (무한 루프 방지)
      if (isLoggingOut) {
        return null;
      }

      isLoggingOut = true;

      // Refresh Token도 만료된 경우 - 토큰 삭제
      authStorage.clearToken();

      // 로그인 페이지로 리다이렉트 (한 번만 실행)
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
      return null;
    } finally {
      // (3) 성공/실패 무관하게 플래그를 비워준다.
      //     → 다음 만료 사이클에서 다시 큐를 만들 수 있도록 초기화.
      isRefreshing = false;
      refreshPromise = null;
    }
  })();
  return refreshPromise;
};

authClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: number;
    };

    // Refresh API 엔드포인트는 interceptor 로직에서 제외
    if (originalRequest?.url?.includes(REFRESH_API_ENDPOINT)) {
      return Promise.reject(error);
    }

    // 401 Unauthorized 에러 처리
    if (error.response?.status === 401 && originalRequest) {
      // 재시도 횟수 확인 (무한 재시도 방지)
      const retryCount = originalRequest._retry || 0;

      if (retryCount >= MAX_RETRY_COUNT) {
        console.error('[Auth API] 최대 재시도 횟수 초과');

        // 로그인 페이지로 리다이렉트
        authStorage.clearToken();

        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }

      try {
        // Access Token 갱신
        const newAccessToken = await refreshAccessToken();

        if (!newAccessToken) {
          return Promise.reject(error);
        }

        // 재시도 횟수 증가
        originalRequest._retry = retryCount + 1;
        originalRequest.headers = originalRequest.headers ?? {};
        // 새로운 토큰으로 헤더 업데이트
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;

        // 원래 요청 재시도
        return authClient(originalRequest);
      } catch (refreshError) {
        console.error('[Auth API] Token refresh 실패:', refreshError);
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

// 로그인 성공 후 isLoggingOut 플래그 리셋 (router.push 방식 대비)
export function resetLoggingOutFlag() {
  isLoggingOut = false;
}

// 하위 호환성을 위한 기본 export (기존 코드와의 호환)
// 점진적 마이그레이션을 위해 authClient를 기본으로 사용
export const httpClient = authClient;
