/**
 * axios 인스턴스 1개 + 인터셉터 (설계 §5.5).
 *
 * 요청:  SecureStore 의 accessToken 을 `Authorization: Bearer` 로 자동 첨부.
 * 응답:  401 이면 곧바로 로그아웃하지 말고 **refresh 를 1회** 시도한 뒤 원요청을 재시도한다.
 *        그것도 실패하면 세션이 끝난 것이므로 토큰을 지우고 로그아웃 콜백을 부른다.
 *
 * 동시성: 화면 두 곳이 동시에 401 을 받으면 refresh 가 두 번 나가고, refresh 는 1회용 회전이라
 *        뒤에 도착한 쪽이 401 로 죽는다. 그래서 진행 중인 refresh Promise 를 공유한다
 *        (웹 `frontend/src/lib/axios/axios-http-client.ts` 와 같은 구조).
 */
import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { API_BASE_URL, CLIENT_HEADER } from './config';
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from './token-storage';

export interface AuthUser {
  id: number;
  email: string;
  nickName: string;
  roles: string[];
  isDemo: boolean;
}

export interface LoginResponse {
  accessToken: string;
  /** X-Client: mobile 을 보냈을 때만 내려온다(설계 §5.6). */
  refreshToken?: string;
  expiresIn: number;
  tokenType: string;
  user: AuthUser;
}

/** 재시도 여부 표시 — 무한 재시도 방지용 내부 플래그 */
type RetriableConfig = AxiosRequestConfig & { _retried?: boolean };

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json', ...CLIENT_HEADER },
});

/** 세션이 완전히 끝났을 때 AuthContext 가 화면을 로그인으로 되돌리도록 연결하는 훅 */
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

/** 진행 중인 refresh. 동시 401 은 이 Promise 를 함께 기다린다. */
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const token = getRefreshToken();
    if (!token) return null;

    try {
      // 인터셉터를 타지 않는 별도 요청 — 만료된 accessToken 을 붙여 보낼 이유가 없고,
      // refresh 자체가 401 일 때 재귀 refresh 로 빠지는 것도 막는다.
      const { data } = await axios.post<LoginResponse>(
        `${API_BASE_URL}/auth/refresh`,
        { refreshToken: token },
        { headers: { 'Content-Type': 'application/json', ...CLIENT_HEADER }, timeout: 15_000 },
      );
      await saveTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
      return data.accessToken;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined;

    if (error.response?.status !== 401 || !config || config._retried) {
      return Promise.reject(error);
    }

    config._retried = true;
    const newToken = await refreshAccessToken();

    if (!newToken) {
      await clearTokens();
      onSessionExpired?.();
      return Promise.reject(error);
    }

    config.headers = { ...config.headers, Authorization: `Bearer ${newToken}` };
    return api.request(config);
  },
);

// ─── 엔드포인트 ────────────────────────────────────────────

export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', { email, password });
  return data;
}

/**
 * GET /auth/me 는 login 응답과 달리 User 엔티티를 그대로 내려준다 — roles 가 `{ name: 'admin' }`
 * 객체 배열이다(login 은 문자열 배열). 앱 안에서는 AuthUser 한 형태로 통일한다.
 * 안 하면 앱 재시작(부팅 시 /auth/me) 후 프로필의 권한 칸이 "[object Object]" 로 보인다.
 */
type MeResponse = Omit<AuthUser, 'roles' | 'isDemo'> & {
  roles?: Array<string | { name: string }>;
  isDemo?: boolean;
};

export async function fetchMe(): Promise<AuthUser> {
  const { data } = await api.get<MeResponse>('/auth/me');
  return {
    id: data.id,
    email: data.email,
    nickName: data.nickName,
    isDemo: data.isDemo ?? false,
    roles: (data.roles ?? []).map((role) => (typeof role === 'string' ? role : role.name)),
  };
}

/**
 * 서버 쪽 세션도 함께 끊는다. 앱은 쿠키가 없으므로 refreshToken 을 body 로 실어야
 * 백엔드가 그 토큰을 무효화할 수 있다(안 보내면 7일간 살아남는다).
 */
export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken();
  try {
    await api.post('/auth/logout', refreshToken ? { refreshToken } : {});
  } catch {
    // 네트워크 실패로 서버 로그아웃이 안 되더라도 로컬 토큰은 반드시 지운다.
  }
  await clearTokens();
}

export interface IncidentSummary {
  id: string;
  title: string;
  level: 'error' | 'warning' | 'info';
  count: number;
  lastSeen: string;
}

/** GET /v1/ops/incidents — 백엔드가 Sentry 를 대신 조회해 축약형으로 내려준다(설계 §5.1·§5.2). */
export async function fetchIncidents(): Promise<IncidentSummary[]> {
  const { data } = await api.get<IncidentSummary[]>('/ops/incidents');
  return data;
}

export interface IncidentStackFrame {
  filename: string | null;
  function: string | null;
  lineNo: number | null;
  colNo: number | null;
  /** true = 우리 코드, false = 라이브러리/런타임 */
  inApp: boolean;
}

export interface IncidentBreadcrumb {
  timestamp: string | null;
  category: string | null;
  level: string | null;
  message: string | null;
}

export interface IncidentDetail extends IncidentSummary {
  firstSeen: string;
  culprit: string | null;
  project: string | null;
  status: string;
  /** 최근 호출이 앞에 오는 상위 30 프레임. 예외 없는 이벤트면 null */
  exception: { type: string | null; value: string | null; frames: IncidentStackFrame[] } | null;
  /** 시간순(오래된 것 → 최근), 최근 30개 */
  breadcrumbs: IncidentBreadcrumb[];
}

/** GET /v1/ops/incidents/:id — 스택트레이스·breadcrumbs 축약형(설계 §4.3 S3). 없는 id 는 404. */
export async function fetchIncident(id: string): Promise<IncidentDetail> {
  const { data } = await api.get<IncidentDetail>(`/ops/incidents/${encodeURIComponent(id)}`);
  return data;
}

/**
 * POST /v1/ops/devices — 이 기기로 푸시를 받겠다고 백엔드에 알린다(설계 §5.1).
 * 앱이 켜질 때마다 불러도 안전하다(백엔드가 upsert).
 */
export async function registerDevice(expoPushToken: string, platform: 'ios' | 'android'): Promise<void> {
  await api.post('/ops/devices', { expoPushToken, platform });
}
