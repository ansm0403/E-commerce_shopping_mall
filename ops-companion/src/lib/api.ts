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
import { traceAnalysisRequest } from './sentry';
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
 * GET /v1/ops/release-health — 릴리즈별 crash-free 세션 비율(설계 §6).
 *
 * 세션 = 앱을 한 번 열어서 쓰는 동안. crash-free = 그중 크래시 없이 끝난 비율이다.
 * 이 수치도 앱이 Sentry 를 직접 부르지 않고 백엔드를 거친다 — 토큰을 앱에 넣지 않기 위해서다.
 */
export interface ReleaseHealthItem {
  release: string;
  /** 0~1. 집계 기간에 세션이 없으면 null */
  crashFreeRate: number | null;
  sessions: number;
}

export interface ReleaseHealth {
  /** 집계 기간. 예: "14d" */
  period: string;
  /** 세션 많은 순 */
  releases: ReleaseHealthItem[];
}

export async function fetchReleaseHealth(): Promise<ReleaseHealth> {
  const { data } = await api.get<ReleaseHealth>('/ops/release-health');
  return data;
}

/**
 * POST /v1/ops/devices — 이 기기로 푸시를 받겠다고 백엔드에 알린다(설계 §5.1).
 * 앱이 켜질 때마다 불러도 안전하다(백엔드가 upsert).
 */
export async function registerDevice(expoPushToken: string, platform: 'ios' | 'android'): Promise<void> {
  await api.post('/ops/devices', { expoPushToken, platform });
}

// ─── AI 분석 (Phase 3, 설계 §3.4 · §5.4) ──────────────────────

export type AnalysisSeverity = 'critical' | 'high' | 'medium' | 'low';
export type AnalysisConfidence = 'high' | 'medium' | 'low';

/**
 * 백엔드가 **검증을 통과시킨** 분석 결과(설계 §5.4). status 가 'ok' 일 때만 온다.
 * 그래도 화면은 각 필드를 optional 처럼 방어해서 그린다(설계 §3.4 방어 처리 (b)) — 서버 쪽 검증이
 * 바뀌거나 옛 행이 남아 있어도 앱이 깨지면 안 된다.
 */
export interface AiAnalysis {
  severity: AnalysisSeverity;
  rootCause: string;
  suggestedFix: string;
  relatedFiles: string[];
  confidence: AnalysisConfidence;
}

export interface IncidentAnalysis {
  id: number;
  incidentId: string;
  /** ok = 구조화 카드 / parse_failed = 원문 fallback(설계 §4.3 S4) */
  status: 'ok' | 'parse_failed';
  result: AiAnalysis | null;
  /** parse_failed 일 때 모델이 실제로 뱉은 원문(백엔드가 마스킹·절단) */
  rawText: string | null;
  promptVersion: string;
  model: string | null;
  latencyMs: number;
  /** few-shot 예시로 들어간 분석 id(Phase 4). v1(예시 없음)이면 null. 메타 줄이 "v2 · 예시 3" 으로 그린다 */
  fewShotIds?: number[] | null;
  createdAt: string;
}

export interface AnalyzeOptions {
  /** 최근 결과가 있어도 새로 분석한다("다시 분석" 버튼) */
  force?: boolean;
  /** 개발 빌드 전용 — 백엔드가 LLM 없이 구조화 실패 행을 만든다(강제 실패 테스트). 운영 서버는 무시한다 */
  simulate?: 'parse_failed';
}

/**
 * POST /v1/ops/incidents/:id/analysis — 분석을 만들거나(첫 호출, 몇 초 걸린다) 최근 결과를 받는다.
 *
 * POST 인데 "조회"처럼 쓰는 이유: 첫 호출이 LLM 을 부르고 행을 만드는 부수효과가 있어서다.
 * 두 번째부터는 백엔드가 저장된 행을 그대로 주므로(X-Cache: HIT) 화면을 다시 열어도 AI 를 다시 부르지 않는다.
 *
 * 타임아웃을 기본 15초보다 길게 준다 — 무료티어 모델이 스키마를 어겨 백엔드가 1회 재시도하면 20초를 넘길 수 있다.
 * 요청 전체를 Sentry span 으로 감싼다(설계 §6 "AI 호출 계측") — 사용자가 체감한 지연이 이 값이다.
 */
export async function requestAnalysis(id: string, options: AnalyzeOptions = {}): Promise<IncidentAnalysis> {
  return traceAnalysisRequest(id, Boolean(options.force), async (setStatus) => {
    const { data } = await api.post<IncidentAnalysis>(
      `/ops/incidents/${encodeURIComponent(id)}/analysis`,
      options,
      { timeout: 45_000 },
    );
    setStatus(data.status);
    return data;
  });
}

// ─── 평가 루프 (Phase 4, 설계 §4.3 S5 · §5.1) ──────────────────────

export type ReviewVerdict = 'approved' | 'rejected';

/**
 * GET /v1/ops/analyses/pending 의 항목 — 내가 아직 채점하지 않은, 구조화에 성공한 분석.
 *
 * promptVersion 이 **없다**. 평가는 블라인드다(설계 §9 Phase 4 결정 ①) — "이건 v2 니까" 하고 후하게 줄 수 있는
 * 정보는 카드에서 숨기는 게 아니라 백엔드가 응답에서 뺀다. 버전은 채점이 끝난 뒤 집계에서만 드러난다.
 */
export interface PendingReview {
  analysisId: number;
  incidentId: string;
  /** 분석 시점에 저장한 제목. Phase 3 시절의 옛 행은 null — 화면은 incidentId 로 대신 그린다 */
  incidentTitle: string | null;
  exceptionText: string | null;
  result: AiAnalysis;
  model: string | null;
  createdAt: string;
}

export interface ReviewInput {
  verdict: ReviewVerdict;
  /** 1~5. 별점을 안 고르고 스와이프만 하면 보내지 않는다 */
  rating?: number;
  comment?: string;
}

export interface ReviewResult {
  id: number;
  analysisId: number;
  reviewerId: number;
  verdict: ReviewVerdict;
  rating: number | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchPendingReviews(): Promise<PendingReview[]> {
  const { data } = await api.get<PendingReview[]>('/ops/analyses/pending');
  return data;
}

/**
 * POST /v1/ops/analyses/:id/review — 판정 저장. 같은 분석을 다시 평가하면 백엔드가 덮어쓴다(upsert, 결정 ⑤).
 * 그래서 낙관적 업데이트가 실패해 카드를 되돌린 뒤 다시 스와이프해도 같은 경로를 탄다.
 */
export async function submitReview(analysisId: number, input: ReviewInput): Promise<ReviewResult> {
  const { data } = await api.post<ReviewResult>(`/ops/analyses/${analysisId}/review`, input);
  return data;
}
