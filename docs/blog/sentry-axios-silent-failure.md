# Sentry를 붙였는데, API 장애를 단 한 건도 못 잡고 있었다

> 프론트엔드에 Sentry를 붙이고 "이제 에러는 다 보인다"고 믿고 있었다.
> 그런데 백엔드가 10분간 완전히 죽은 동안 Sentry에는 이슈가 **0건** 올라왔다.
> 원인은 Sentry 설정이 아니라 **axios 인터셉터의 한 줄**이었다.

---

## 1. 한 줄 요약

- axios가 실패를 `Promise.reject(error)`로 넘기고, 그걸 TanStack Query가 받아 처리하는 순간 그 에러는 **"처리된(handled) 예외"** 가 된다.
- Sentry 브라우저 SDK는 기본적으로 **처리되지 않은(unhandled) 에러만** 잡는다. 그래서 API 실패는 SDK의 시야에 애초에 들어오지 않는다.
- 즉 **SDK는 정상이었고, 에러도 실제로 났고, 다만 Sentry가 그걸 에러로 볼 계기가 없었다.**
- 고치는 방법은 인터셉터에서 `Sentry.captureException()`을 **명시적으로** 부르는 것이다. 다만 무엇을 보내고 무엇을 버릴지 기준이 필요하다(§7).

---

## 2. 증상

운영 중인 쇼핑몰의 백엔드(EC2)를 테스트 목적으로 잠시 내렸다. 프론트(Vercel)는 그대로 살아 있었다.

| 항목 | 값 |
|---|---|
| 백엔드 중단 시간 | 약 16분 |
| 그동안 프론트에서 상품 목록 페이지 접속 | 함 |
| 브라우저 콘솔에 찍힌 에러 | 다수 (`ERR_CONNECTION_REFUSED`) |
| 외부 모니터링(UptimeRobot) 감지 | ✅ 감지함 |
| **Sentry 프론트엔드 프로젝트에 올라온 이슈** | **0건** |

사용자 입장에서는 상품 목록이 전혀 안 보이는 **완전한 장애**였다. 그런데 에러 추적 도구는 아무 말이 없었다.

---

## 3. 처음 의심한 것들, 그리고 왜 아니었나

프론트 Sentry는 예전에도 "이벤트가 안 간다"는 문제를 겪은 적이 있어서 SDK 자체를 먼저 의심했다. 하지만 하나씩 지워졌다.

| 의심 | 확인 방법 | 결과 |
|---|---|---|
| DSN이 빌드에 안 들어갔나 | 배포된 페이지에서 `window.__SENTRY__` 확인 | 존재함, 클라이언트 초기화됨 |
| 광고 차단기가 막았나 | `tunnelRoute` 경로로 실제 요청이 가는지 확인 | 같은 오리진으로 정상 전송, 응답 200 |
| Sentry 알림 룰 문제인가 | Slack이 아니라 Sentry 웹 콘솔의 Issues 화면을 직접 확인 | 이슈 자체가 없음 |
| 이벤트가 기존 이슈에 묶였나 | 기간·환경 필터를 모두 풀고 확인 | 해당 시간대 이벤트 없음 |

**"알림이 안 왔다"와 "이슈가 없다"는 전혀 다른 문제다.** 알림 룰이 보통 "새 이슈가 생성될 때"로 걸려 있어서, 같은 에러가 반복되면 이슈에 이벤트만 쌓이고 알림은 안 온다. 그래서 Slack이 조용한 것만 보고 판단하면 안 되고 **Issues 화면을 직접 봐야 한다.** 이번에는 Issues 화면에도 아무것도 없었다.

---

## 4. 측정: 대조군을 세운다

"안 온다"는 관찰만으로는 원인을 특정할 수 없다. 그래서 헤드리스 브라우저(Playwright)로 배포된 사이트를 열고, **Sentry로 나가는 요청의 본문을 직접 뜯어봤다.**

Sentry가 보내는 것은 **envelope**이라는 줄 단위 JSON 포맷이다. 첫 줄이 헤더이고 그 뒤로 `(아이템 헤더, 페이로드)` 쌍이 이어진다. 아이템 헤더의 `type`을 보면 그게 에러인지 세션인지 리플레이인지 구분된다.

```js
// envelope 파싱 — type만 뽑아낸다
function parseEnvelope(body) {
  const items = [];
  const lines = String(body).split('\n');
  for (let i = 1; i < lines.length; i++) {
    const h = JSON.parse(lines[i]);          // 아이템 헤더
    if (h?.type) {
      const payload = lines[i + 1];          // 실제 내용
      items.push({ type: h.type, payload });
      i++;
    }
  }
  return items;
}
```

세 가지 시나리오를 돌렸다. **핵심은 C(대조군)이다.** 장애 상황이 정상 상황과 구분되지 않는다면 그 자체가 답이다.

| 시나리오 | 방법 | Sentry로 나간 아이템 | 에러 이벤트 |
|---|---|---|---|
| **A** | 진짜 uncaught 에러를 던짐 | session 1, **event 1**, replay 4 | ✅ 도착 |
| **B** | 모든 `/api/**` 요청 차단 (백엔드 다운 재현) | session 3 | **0건** |
| **C** | 대조군 — 아무 조작 없음 | session 3 | 0건 |

```js
// B: 백엔드가 죽은 상황을 운영 서버를 건드리지 않고 재현한다
await page.route('**/api/**', route => route.abort('connectionrefused'));
```

**A가 성공했으므로 SDK는 멀쩡하다.** 그리고 **B와 C가 완전히 같다.** 백엔드가 통째로 죽은 상황과 아무 문제 없는 상황이 Sentry 입장에서 구분되지 않는다는 뜻이다. 2회 반복 실행에서 동일하게 재현됐다.

브라우저 콘솔에는 연결 거부 에러가 17건 찍혀 있었다. 그중 단 하나도 Sentry로 가지 않았다.

---

## 5. 원인: Sentry는 "처리되지 않은" 에러만 잡는다

Sentry 브라우저 SDK가 **자동으로** 에러를 포착하는 경로는 사실상 셋뿐이다.

1. `window.onerror` — 스크립트 실행 중 던져진 예외
2. `window.onunhandledrejection` — **아무도 잡지 않은** Promise 거부
3. `setTimeout`·`addEventListener` 같은 브라우저 API 콜백 래핑

여기에 **HTTP 요청 실패는 없다.** SDK는 fetch와 XHR을 가로채긴 하지만, 그건 **브레드크럼(breadcrumb)과 트레이싱 span을 남기기 위해서**다. 500 응답이나 연결 실패는 SDK에게 "에러"가 아니라 "기록해 둘 만한 사건"일 뿐이다.

그래서 이런 일이 벌어진다.

```
axios 요청 실패
   ↓
인터셉터가 Promise.reject(error)      ← 거부된 Promise가 생김
   ↓
TanStack Query가 .catch 로 받음        ← 여기서 "처리됨"이 된다
   ↓
query.isError = true → 화면에 에러 UI
   ↓
window.onunhandledrejection 발생 안 함  ← Sentry가 알 방법이 없다
```

**역설적인 점**: 실패한 요청은 Sentry의 **브레드크럼에는 남아 있다.** 다만 브레드크럼은 이슈가 생겼을 때 그 이슈에 첨부되는 부록이다. 이슈 자체가 안 생기면 브레드크럼도 영원히 서버로 가지 않는다.

> 요약하면 **에러 처리를 잘 할수록 Sentry는 더 조용해진다.** `try/catch`로 감싸거나 쿼리 라이브러리에 맡기는 순간, 그 에러는 관측 도구의 시야에서 사라진다. 이건 Sentry의 버그가 아니라 설계다. "처리했다"는 건 "의도한 흐름"이라는 선언이기 때문이다.

---

## 6. 수정 전 코드

문제의 파일은 `lib/axios/axios-http-client.ts`다. 두 군데가 문제였다.

```ts
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { authStorage } from '../../service/auth-storage';

const baseConfig = {
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  timeout: 5000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
};

const MAX_RETRY_COUNT = 3;
const REFRESH_API_ENDPOINT = '/auth/refresh';

// ───────── 문제 ①: 공개 클라이언트에는 응답 인터셉터가 아예 없다 ─────────
export const publicClient = axios.create(baseConfig);

publicClient.interceptors.request.use(
  (config) => config,
  (error) => Promise.reject(error)
);
// 응답 쪽은 손대지 않았다 → 상품 목록·카테고리 등 비로그인 API 실패는 전부 그냥 통과

// ───────── 문제 ②: 인증 클라이언트는 401만 처리하고 나머지는 흘려보낸다 ─────
export const authClient = axios.create(baseConfig);

authClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: number;
    };

    if (originalRequest?.url?.includes(REFRESH_API_ENDPOINT)) {
      return Promise.reject(error);                    // ← 조용히 사라짐
    }

    if (error.response?.status === 401 && originalRequest) {
      const retryCount = originalRequest._retry || 0;

      if (retryCount >= MAX_RETRY_COUNT) {
        authStorage.clearToken();
        if (typeof window !== 'undefined') window.location.href = '/login';
        return Promise.reject(error);                  // ← 조용히 사라짐
      }

      try {
        const newAccessToken = await refreshAccessToken();
        if (!newAccessToken) return Promise.reject(error);   // ← 조용히 사라짐

        originalRequest._retry = retryCount + 1;
        originalRequest.headers = originalRequest.headers ?? {};
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return authClient(originalRequest);
      } catch (refreshError) {
        return Promise.reject(refreshError);            // ← 조용히 사라짐
      }
    }

    return Promise.reject(error);                       // ← 500도, 연결 실패도 여기로
  }
);
```

마지막 줄이 핵심이다. **서버가 500을 뱉든, 서버가 아예 없든, 타임아웃이 나든 전부 이 한 줄을 지나 조용히 호출부로 넘어간다.**

---

## 7. 수정 후 코드

`Sentry.captureException()`을 명시적으로 부르면 된다. 다만 **전부 다 보내면 안 된다.** 기준이 필요하다.

```ts
import * as Sentry from '@sentry/nextjs';
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { authStorage } from '../../service/auth-storage';

const baseConfig = {
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  timeout: 5000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
};

const MAX_RETRY_COUNT = 3;
const REFRESH_API_ENDPOINT = '/auth/refresh';

// ════════════════════════════════════════════════════════════════
//  추가된 부분: API 실패를 Sentry로 올리는 공용 리포터
// ════════════════════════════════════════════════════════════════

/** 쿼리스트링을 떼어낸다. fingerprint 가 페이지·정렬마다 갈라지는 걸 막는다. */
function toPath(url?: string): string {
  if (!url) return 'unknown';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/**
 * API 실패를 Sentry 이슈로 올린다.
 *
 * 보내는 것 : 네트워크 계층 실패(서버 부재·타임아웃·DNS) + 5xx
 * 버리는 것 : 4xx (401 만료, 403 권한, 404 없음, 400 검증 실패)
 *            — 전부 "설계된 흐름"이라 이슈로 올리면 노이즈만 된다
 *            취소된 요청 (사용자가 페이지를 떠남)
 */
export function reportApiError(
  error: AxiosError,
  client: 'public' | 'auth',
): void {
  if (axios.isCancel(error) || error.code === 'ERR_CANCELED') return;

  const status = error.response?.status;
  const isNetworkFailure = !error.response;       // 응답 자체가 없음
  const isServerFailure = (status ?? 0) >= 500;
  if (!isNetworkFailure && !isServerFailure) return;

  const method = (error.config?.method ?? 'get').toUpperCase();
  const path = toPath(error.config?.url);
  const label = String(status ?? error.code ?? 'NETWORK');

  Sentry.captureException(error, {
    // 같은 엔드포인트의 같은 실패를 한 이슈로 묶는다.
    // 안 묶으면 URL 하나하나가 별개 이슈가 되어 무료 쿼터가 순식간에 녹는다.
    fingerprint: ['api', client, method, path, label],
    level: 'error',
    tags: {
      'api.client': client,
      'api.method': method,
      'api.path': path,
      'api.status': label,
    },
    contexts: {
      api: {
        path,
        method,
        status: status ?? null,
        code: error.code ?? null,      // ERR_NETWORK, ECONNABORTED ...
        timeoutMs: baseConfig.timeout,
        fullUrl: error.config?.url ?? null,   // 쿼리 포함 원본은 여기 남긴다
      },
    },
  });
}

// ════════════════════════════════════════════════════════════════
//  수정 ①: 공개 클라이언트에 응답 인터셉터를 새로 단다
// ════════════════════════════════════════════════════════════════
export const publicClient = axios.create(baseConfig);

publicClient.interceptors.request.use(
  (config) => config,
  (error) => Promise.reject(error)
);

publicClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    reportApiError(error, 'public');     // ← 추가
    return Promise.reject(error);        // 기존 동작은 그대로 유지
  }
);

// ════════════════════════════════════════════════════════════════
//  수정 ②: 인증 클라이언트의 모든 "탈출 지점"에 리포터를 넣는다
// ════════════════════════════════════════════════════════════════
export const authClient = axios.create(baseConfig);

authClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: number;
    };

    if (originalRequest?.url?.includes(REFRESH_API_ENDPOINT)) {
      reportApiError(error, 'auth');     // ← 추가 (401 은 필터가 걸러낸다)
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && originalRequest) {
      const retryCount = originalRequest._retry || 0;

      if (retryCount >= MAX_RETRY_COUNT) {
        authStorage.clearToken();
        if (typeof window !== 'undefined') window.location.href = '/login';
        return Promise.reject(error);    // 401 만료는 정상 흐름 → 보내지 않는다
      }

      try {
        const newAccessToken = await refreshAccessToken();
        if (!newAccessToken) return Promise.reject(error);

        originalRequest._retry = retryCount + 1;
        originalRequest.headers = originalRequest.headers ?? {};
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return authClient(originalRequest);
      } catch (refreshError) {
        // 토큰 갱신 자체가 깨진 것은 심각하다. 반드시 올린다.
        Sentry.captureException(refreshError, {
          fingerprint: ['api', 'auth', 'refresh-failed'],
          level: 'error',
        });
        return Promise.reject(refreshError);
      }
    }

    reportApiError(error, 'auth');       // ← 추가 (5xx·네트워크 실패가 여기로)
    return Promise.reject(error);
  }
);
```

**기존 동작은 하나도 바뀌지 않았다.** `Promise.reject(error)`는 그대로 남아 있고, 호출부(TanStack Query)가 받는 것도 그대로다. 관측만 한 겹 덧댔다.

---

## 8. 무엇을 보내고 무엇을 버릴 것인가

무작정 전부 보내면 두 가지가 망가진다. **무료 쿼터**와 **알림 신뢰도**다.

| 분류 | 예 | 보낼까 | 이유 |
|---|---|---|---|
| 네트워크 실패 | 연결 거부, 타임아웃, DNS 실패 | ✅ | 이게 이번 장애의 정체다 |
| 5xx | 500, 502, 503 | ✅ | 서버가 깨진 것 |
| 401 | 토큰 만료 | ❌ | 15분마다 정상적으로 발생한다 |
| 403 | 권한 없음 | ❌ | 의도된 거부 |
| 404 | 없는 리소스 | ❌ | 잘못된 링크는 UI 문제 |
| 400 | 검증 실패 | ❌ | 사용자 입력 문제 |
| 취소 | 페이지 이탈로 요청 중단 | ❌ | 에러가 아니다 |

특히 **401을 보내면 안 되는 이유**가 중요하다. access 토큰 수명이 15분이라면, 활성 사용자 한 명당 하루 수십 건의 401이 정상적으로 발생한다. 이걸 전부 올리면 Sentry 무료 플랜의 월 5,000건 쿼터가 며칠 만에 사라지고, 그 사이에 진짜 장애가 묻힌다.

**403·404는 판단이 갈릴 수 있다.** 인가 로직을 방금 고쳤다면 403 급증이 회귀 신호일 수 있다. 그럴 땐 이슈로 올리는 대신 `Sentry.metrics`나 별도 카운터로 세는 쪽이 낫다. 이슈는 "사람이 고쳐야 할 것"만 담는 게 좋다.

---

## 9. 함정: fingerprint와 알림 룰은 서로 엮여 있다

`fingerprint`로 그룹을 묶는 건 쿼터를 지키는 데 필수지만, **알림 룰과 상호작용해서 뜻밖의 결과를 만든다.**

Sentry의 기본 알림 룰은 보통 이렇게 생겼다.

```
When: A new issue is created
Then: Send a notification to Slack
```

여기에 커스텀 fingerprint를 더하면 이렇게 된다.

1. `/products`가 처음 500을 뱉음 → **새 이슈** → Slack 알림 ✅
2. 그 이슈를 확인하고 "Resolve" 처리
3. 다음 주에 같은 장애 재발 → **새 이슈가 아니라 회귀(regression)** → Slack 알림 ❌

즉 **엔드포인트 하나당 평생 한 번만 알림이 온다.** 이건 실제로 겪은 문제다. 알림 룰에 조건을 추가해야 한다.

```
When any of the following occur:
  A new issue is created                                  ← 첫 발생
  The issue changes state from resolved to unresolved     ← 회귀 (추가 필요)
  Sentry marks an existing issue as high priority         ← 급증 (추가 필요)
```

**교훈은 "룰이 존재한다"와 "알림이 도착한다"가 다르다는 것이다.** 이번 조사 중에 의도적으로 새 이슈를 만들어봤는데, Sentry 웹에는 `Level: Error`로 정상 기록됐지만 Slack에는 오지 않았다.

원인을 파보니 룰 설정 문제가 아니었다. **Sentry의 Slack 통합은 Team 플랜 이상에서만 동작한다.** 무료 Developer 플랜은 이메일과 앱 내 알림만 지원한다. 계정을 만들면 14일간 상위 플랜 기능을 써볼 수 있는데, 그때 연결해 둔 Slack 통합이 체험 종료와 함께 조용히 비활성으로 바뀐 것이었다. **알림 채널 하나가 수개월간 죽어 있었고 아무도 몰랐다.**

여기서 두 가지를 배웠다.

**첫째, 무료 플랜의 경계선은 직접 재봐야 한다.** 요금 페이지 문구가 애매할 때가 많다. Sentry 요금표의 Team 항목에 "API 및 서드파티 통합"이라고 적혀 있어서 Web API까지 유료인 줄 알았는데, 토큰을 만들어 실제로 호출해보니 무료 플랜에서 잘 됐다.

```bash
# 플랜 제한이면 403, 슬러그가 틀리면 404, 되면 200
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" \
  https://sentry.io/api/0/organizations/
```

**둘째, SaaS 알림 통합에 의존하면 그쪽 정책에 인질이 된다.** 대안은 간단하다. Slack Incoming Webhook은 Slack의 무료 기능이고 Sentry와 무관하다. 백엔드에서 직접 POST하면 플랜 제약 없이 같은 채널에 알림을 보낼 수 있고, 무엇을 어떤 기준으로 보낼지도 직접 정할 수 있다.

**그리고 통로가 죽은 것을 알아채는 장치를 따로 두자.** 분기에 한 번씩 각 알림 경로에 테스트 이벤트를 흘려보고 실제로 도착하는지 확인하는 것으로 충분하다. 이번에 UptimeRobot 다운 알림 메일이 **스팸함**에 들어가 있던 것도 같은 점검에서 잡혔을 문제다.

---

## 10. 대안: TanStack Query의 QueryCache에서 잡기

axios 인터셉터 대신 쿼리 레이어에서 잡는 방법도 있다.

```ts
import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import * as Sentry from '@sentry/nextjs';

new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      Sentry.captureException(error, {
        // 쿼리 키가 그대로 그룹핑 기준이 된다
        fingerprint: ['query', ...query.queryKey.map(String)],
        contexts: { query: { key: JSON.stringify(query.queryKey) } },
      });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      Sentry.captureException(error, {
        fingerprint: ['mutation', mutation.options.mutationKey?.join('-') ?? 'unknown'],
      });
    },
  }),
});
```

| | axios 인터셉터 | QueryCache onError |
|---|---|---|
| 포착 범위 | **모든** HTTP 호출 (Query 밖의 직접 호출 포함) | Query/Mutation을 거친 것만 |
| 얻는 맥락 | URL, 메서드, 상태코드 | **쿼리 키**, 재시도 횟수 |
| 재시도와의 관계 | 재시도 **매 회** 발동 | 최종 실패 **1회만** 발동 |
| 필터링 | 직접 구현 | 직접 구현 |

**재시도 항목이 실무에서 가장 크게 갈린다.** TanStack Query는 기본적으로 실패를 3회 재시도하는데, axios 인터셉터에 붙이면 같은 장애가 이벤트 3건이 된다. 쿼터를 생각하면 **QueryCache 쪽이 유리하다.**

반대로 인터셉터는 쿼리 훅을 거치지 않는 호출까지 전부 덮는다. 로그인 폼에서 직접 부르는 `authClient.post('/auth/login')` 같은 것들이다.

**둘 다 쓰는 것도 방법이다.** 인터셉터는 네트워크 계층 실패만(서버 부재), QueryCache는 나머지를 맡기는 식으로 역할을 나누면 중복 없이 커버 범위를 넓힐 수 있다.

---

## 11. 검증 방법

고친 뒤에는 **같은 실험을 다시 돌려서 B가 C와 달라지는지** 확인하면 된다. 운영 서버를 건드릴 필요가 없다.

```js
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// Sentry로 나가는 요청만 골라 본다 (tunnelRoute를 쓰면 같은 오리진으로 나간다)
const events = [];
page.on('request', req => {
  const u = req.url();
  if (u.includes('/monitoring') || u.includes('sentry.io')) {
    const body = req.postData() ?? '';
    // envelope 안에 "type":"event" 가 있으면 에러 이벤트다
    if (body.includes('"type":"event"')) events.push(u);
  }
});

// 백엔드가 죽은 상황을 재현한다
await page.route('**/api/**', route => route.abort('connectionrefused'));

await page.goto('https://내-사이트.example.com');
await new Promise(r => setTimeout(r, 12000));

console.log('에러 이벤트:', events.length, '건');   // 고치기 전 0 → 고친 후 1 이상
await browser.close();
```

수동으로 확인하려면 개발자도구 Network 탭을 열고 `monitoring` 또는 `ingest.sentry.io`로 필터를 건 다음, 백엔드를 끄거나 오프라인 모드로 전환하고 페이지를 새로고침하면 된다. 요청이 나가는지, 그 본문에 `"type":"event"`가 있는지 보면 된다.

---

## 12. 교훈

1. **에러 추적 도구를 설치한 것과 에러가 추적되는 것은 다르다.** 설치 직후 "테스트 에러 던지기"는 통과하지만, 그건 unhandled 경로만 확인한 것이다. 정작 서비스에서 가장 흔한 장애인 API 실패는 그 경로를 타지 않는다.

2. **관측 도구는 대조군을 두고 검증해야 한다.** "장애 상황에서 이벤트가 온다"만 보면 부족하다. "정상 상황과 다른가"를 봐야 한다. 이번에 B와 C가 똑같았던 것이 결정적 증거였다.

3. **에러를 잘 처리할수록 관측은 어려워진다.** `try/catch`나 쿼리 라이브러리가 에러를 삼키는 건 좋은 UX지만, 그 지점마다 "이건 기록해야 하나"를 한 번씩 물어야 한다.

4. **"알림이 안 왔다"를 "에러가 없다"로 읽지 말 것.** 알림 룰, 알림 배달, 이슈 생성은 각각 따로 깨질 수 있다. 실제로 이번 조사에서 알림 메일 하나는 **스팸함**에 들어가 있었고, 새 이슈 하나는 룰이 있는데도 Slack에 도달하지 않았다.

5. **무료 티어에서는 "무엇을 안 보낼지"가 설계의 절반이다.** 월 5,000건은 401 하나만 잘못 흘려보내도 며칠 만에 사라진다.

---

## 부록: 이 글에서 쓴 환경

| 항목 | 값 |
|---|---|
| 프론트 | Next.js (App Router), React 19 |
| 데이터 패칭 | TanStack Query + axios |
| 에러 추적 | `@sentry/nextjs`, Developer(무료) 플랜 |
| 배포 | Vercel (프론트) / AWS EC2 + nginx (백엔드) |
| 검증 도구 | Playwright (`playwright-core` + 캐시된 Chromium) |

> ⚠️ 이 글의 **수정 후 코드는 제안 단계이며 아직 운영에 적용해 재측정하지 않았다.**
> 적용 후 §11의 검증을 거쳐 결과를 이어서 기록할 예정이다.
