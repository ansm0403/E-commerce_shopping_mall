# #1. NestJS + Next.js 15 풀스택 멀티 셀러 이커머스 플랫폼

---

## 프론트엔드 성능 최적화 (Core Web Vitals 기준)

> 측정 환경: Vercel 배포 / Chrome Lighthouse Slow 4G throttling

---

### ● RSC/CC 경계 재설계 — LCP 개선

**문제**  
상품 상세 `page.tsx` 최상단에 `'use client'`가 선언되어 있어, 페이지 트리 전체가 클라이언트 번들에 포함되었습니다.  
클라이언트 마운트 이후 `useQuery`가 실행되므로 **HTML 로드 → 마운트 → fetch → 렌더** 2-step waterfall이 발생했습니다.

**해결**  
`page.tsx`를 `async` RSC로 전환하고 서버에서 `prefetchQuery`로 데이터를 선처리.  
`HydrationBoundary`로 직렬화한 캐시를 클라이언트에 주입 → 마운트 직후 즉시 렌더링.

```
이전: 빈 HTML → 마운트 → /api/products/:id fetch → 렌더링
이후: 상품 데이터 포함 HTML → 마운트 → 캐시 히트 → 즉시 렌더링 (추가 API 요청 없음)
```

추가 효과: 초기 HTML에 상품 정보가 포함되어 SEO 개선.

---

### ● SSR prefetchQuery — FCP 개선 (상품 목록)

**문제**  
`products/page.tsx`는 RSC였지만, 실제 데이터 fetch는 CC인 `ProductsClient`가 마운트 후 실행.  
첫 방문 시 상품 그리드 자리에 스켈레톤이 표시되어 FCP에 실제 콘텐츠가 없었습니다.

**해결**  
URL `searchParams`를 서버에서 파싱해 첫 페이지 데이터를 `prefetchQuery`로 미리 적재.

```
이전: 스켈레톤 → 마운트 → API 요청 → 상품 그리드 표시
이후: 캐시 포함 HTML → 마운트 → 즉시 상품 그리드 표시 (스켈레톤 → 데이터 전환 시간 0ms)
```

---

### ● ISR + staleTime 일치 — TTFB 개선 (상품 상세)

상품 상세 페이지는 읽기가 압도적으로 많고 쓰기는 드뭅니다.  
`revalidate: 300` (5분 ISR)으로 Vercel Edge에 정적 캐시를 유지하고,  
클라이언트의 `staleTime: 300_000`을 ISR 주기와 일치시켜 서버-클라이언트 캐시 일관성을 확보했습니다.

```
캐시 MISS (최초 방문): TTFB 높음 (EC2 응답 대기)
캐시 HIT (5분 이내 재방문): TTFB < 50ms (Vercel Edge 응답)
응답 헤더 x-vercel-cache: HIT/MISS 로 캐시 상태 확인
```

---

### ● useDeferredValue + useTransition — INP 개선 (필터·정렬)

**문제**  
카테고리 탭 클릭 시 React가 전체 상품 그리드를 동기 재렌더하는 동안 버튼 UI가 즉각 반응하지 않는 느낌이 있었습니다.

**해결**  
- `useTransition`: 탭 클릭 → 즉각 활성 스타일 변경, 그리드 교체는 낮은 우선순위로 처리  
- `useDeferredValue`: 필터 값을 지연 버전으로 구독해 비싼 렌더링을 React 스케줄러에 위임  
- `isPending` → 그리드 `opacity: 60%` → CLS 없이 "로딩 중" 상태 시각화

```
INP 기준: ≤ 200ms(좋음) / 200~500ms(개선 필요) / > 500ms(나쁨)
```

---

### ● next/image 마이그레이션 — LCP·CLS 개선

**문제**  
기존 `<img>` 태그: 원본 JPEG 그대로 전송, `srcset` 없음, LCP 이미지에 preload 힌트 없음.

**해결**  
- `<img>` → `<Image fill sizes="..." />`: WebP 자동 변환, 디바이스별 `srcset` 자동 생성
- 첫 4개 ProductCard: `priority={true}` → `<link rel="preload">` 자동 삽입 → LCP 단축
- 썸네일·폴드 아래 이미지: `priority` 없음 → lazy load 유지

```
이전: Content-Type: image/jpeg, <link rel="preload"> 없음
이후: Content-Type: image/webp, <link rel="preload" as="image"> 존재
```

---

### ● preconnect — 외부 CDN 연결 지연 절감

PortOne 결제 SDK 로드 시 `cdn.portone.io`에 대한 DNS Lookup + TCP + TLS 핸드셰이크에 100~300ms 소요.  
`<link rel="preconnect">` + `<link rel="dns-prefetch">` (브라우저 fallback)를 `layout.tsx`에 배치해  
HTML 파싱 초기에 연결을 병렬로 선행 처리합니다.

```
이전: 결제 SDK 첫 요청 시 DNS + TCP + TLS 합산 100~300ms
이후: 연결이 미리 맺어져 있어 합산 < 5ms
```

---

## 트러블슈팅

### ● EC2 인스턴스 OOM 문제

`t3.micro` (1GB RAM)에서 NestJS 부팅 중 OOM으로 컨테이너가 즉시 종료되는 문제가 발생했습니다.  
`t3.small` (2GB RAM)로 업그레이드 후 서버는 안정화됐으나,  
EC2 내부에서 `docker build`를 실행하면 node_modules 설치 + Nx 빌드 중 메모리를 다시 초과했습니다.

**해결**: 로컬에서 이미지를 빌드 후 Docker Hub에 push → EC2에서 pull하는 수동 파이프라인 구성.  
빌드 연산 비용을 개발 머신이 부담하고 EC2는 pull + 실행만 담당합니다.

---

### ● Vercel 프록시를 통한 mixed-content 해결

EC2에 HTTPS를 구성하지 않은 상태에서, Vercel(HTTPS)에서 EC2(HTTP)로 직접 API 요청을 보내면  
브라우저가 mixed-content로 차단합니다.

**해결**: `next.config.js rewrites()`로 `/api/*` 요청을 Vercel 서버가 EC2로 서버사이드 프록시.  
브라우저는 항상 Vercel 도메인(HTTPS)에만 요청하므로 mixed-content 및 CORS 이슈를 구조적으로 제거했습니다.  
향후 EC2에 nginx + HTTPS 도입 시 `rewrites()` 제거만으로 전환 가능하도록 코드에 주석으로 보존했습니다.

---

### ● 401 Race Condition — 토큰 갱신 중복 호출

accessToken 만료 시 동시에 여러 요청이 401을 받으면 각각 `/auth/refresh`를 호출해  
refreshToken이 중복 소비되어 세션이 끊기는 문제가 있었습니다.

**해결**: axios interceptor에 `isRefreshing` 플래그를 두고, 첫 번째 401만 refresh를 실행하며  
이후 401 요청은 `Promise queue`에 쌓아 refresh 완료 후 순차 처리합니다.
