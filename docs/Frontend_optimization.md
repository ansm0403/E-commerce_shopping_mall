# Frontend 성능 최적화 기록

> 작성 기준일: 2026-04-28  
> 프로젝트: E-커머스 쇼핑몰 (Next.js 15 App Router + React 19 + TanStack Query)  
> 측정 환경: Vercel 배포 기준, Chrome DevTools Lighthouse (Slow 4G throttling 조건)

---

## 목차

| # | 최적화 항목 | 적용 파일 | 핵심 지표 |
|---|------------|----------|---------|
| OPT-1 | Bundle Analyzer 도입 | `next.config.js` | 번들 크기 가시화 |
| OPT-2 | RSC/CC 경계 재설계 (상품 상세) | `products/[id]/page.tsx` | LCP |
| OPT-3 | ISR — 상품 상세 정적 재생성 | `products/[id]/page.tsx` | TTFB |
| OPT-4 | SSR prefetchQuery (상품 목록) | `products/page.tsx` | FCP |
| OPT-5 | useDeferredValue (필터/정렬) | `ProductsClient.tsx` | INP |
| OPT-6 | staleTime 전략 (Query별 캐시 설정) | `products-query-options.ts` | 네트워크 요청 수 |
| OPT-7 | next/image 마이그레이션 | `ProductCard.tsx`, `ProductGallery.tsx` | LCP, CLS |
| OPT-8 | preconnect (외부 도메인) | `layout.tsx` | 연결 지연 시간 |

---

## OPT-1 — Bundle Analyzer 도입

### 왜 선택했는가
최적화의 시작은 측정이다. 어느 청크가 무거운지 모르면 어디서 손볼지 알 수 없다.  
대안인 Webpack Visualizer와 비교 시, `@next/bundle-analyzer`는 Next.js 공식 도구로 청크 분할 맥락이 잘 보인다.

### 적용 위치
- `frontend/next.config.js` — `withBundleAnalyzer` 플러그인 추가
- `frontend/package.json` — `@next/bundle-analyzer` devDependency, `analyze` 스크립트 추가

### 사용 방법
```bash
# 루트에서
ANALYZE=true yarn nx build frontend
# .next/analyze/client.html, server.html 자동 오픈
```

### 측정 방법 (브라우저 기반)
**브라우저만으로 측정 가능**
1. `ANALYZE=true` 빌드 후 자동으로 열리는 `client.html` 확인
2. 파란 블록 = 번들 크기, 큰 블록 = 최적화 후보
3. "First Load JS" 컬럼이 170KB(gzip) 초과 페이지를 먼저 공략

### 성능 개선 포인트
- 도구 자체가 성능을 올리진 않지만, OPT-2~7의 **효과를 수치로 검증**하는 수단
- 빌드 전후 First Load JS 비교로 각 최적화 효과 정량화 가능

### 측정 결과 기록란
```
[측정 전 — 최적화 전 기준]
/ (홈페이지): First Load JS = ___KB
/products: First Load JS = ___KB
/products/[id]: First Load JS = ___KB
/admin/dashboard: First Load JS = ___KB

[측정 후 — 모든 OPT 적용 후]
/ (홈페이지): First Load JS = ___KB
/products: First Load JS = ___KB
/products/[id]: First Load JS = ___KB
/admin/dashboard: First Load JS = ___KB
```

---

## OPT-2 — RSC/CC 경계 재설계 (상품 상세 페이지)

### 왜 선택했는가
`products/[id]/page.tsx` 최상단에 `'use client'`가 있어 해당 페이지 트리 전체가 클라이언트 번들에 포함됐다.  
이는 다음 문제를 만든다:
1. `page.tsx` 자체가 CC → JS 번들에 포함 → 파싱/실행 시간 증가
2. `useQuery`가 브라우저 마운트 후 실행 → 네트워크 왕복 후 렌더링 (2-step waterfall)
3. SEO: 초기 HTML에 상품 정보 없음

대안: page.tsx 자체를 CC로 유지하면서 SSR prefetch를 하는 방법은 없다. RSC 전환이 유일한 정답.

### 이전 구조 (비교 코드)
```tsx
// ❌ 이전: page.tsx 전체가 CC
'use client';
export default function ProductDetailPage() {
  const params = useParams();           // CC 전용
  const id = parseInt(params.id);
  const { data, isLoading } = useQuery(...); // 브라우저 마운트 후 실행
  if (isLoading) return <Skeleton />;
  return <ProductDetailClient product={data.data} />;
}
```

### 개선된 구조
```tsx
// ✅ 개선: RSC page.tsx
export default async function ProductDetailPage({ params }) {
  const { id } = await params;
  const qc = getQueryClient();
  await qc.prefetchQuery({               // 서버에서 미리 fetch
    queryKey: productsQueryOptions.detail(id).queryKey,
    queryFn: () => serverGet<Product>(`/products/${id}`, { revalidate: 300 }),
  });
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ProductDetailClient productId={id} /> // CC — useQuery가 캐시 히트
    </HydrationBoundary>
  );
}
```

### 적용 위치
- `frontend/src/app/(main)/products/[id]/page.tsx` — RSC 전환, prefetchQuery 추가
- `frontend/src/app/(main)/products/[id]/ProductDetailClient.tsx` — props `product → productId`, 내부 useQuery 추가
- `frontend/src/lib/server-api.ts` — RSC 전용 절대 URL fetch 헬퍼 (신규 생성)

### 성능 개선 포인트
| 단계 | 이전 | 이후 |
|------|-----|-----|
| 서버 응답 | 빈 HTML | React Query 캐시 포함 HTML |
| 클라이언트 마운트 후 | useQuery 실행 → fetch → 렌더 | 캐시 히트 → 즉시 렌더 |
| 추가 네트워크 요청 | `/api/products/:id` 1회 추가 | 없음 |

### 측정 방법 (브라우저 기반)
**브라우저만으로 측정 가능**
1. DevTools > Network 탭 열기
2. 상품 상세 URL 진입
3. `이전`: HTML 로드 후 `/api/products/123` XHR 요청 발생 확인
4. `이후`: 해당 XHR 요청 없음 (또는 없어야 함)

**Lighthouse 비교:**
1. DevTools > Lighthouse > "Slow 4G" + "Performance" 체크
2. 최적화 전 LCP 기록 → `git stash` 또는 별도 브랜치에서 측정
3. 최적화 후 LCP 기록 → 비교

### 측정 결과 기록란
```
[측정 전 — 'use client' page.tsx]
LCP: ___ms
Network waterfall: /api/products/:id 발생 여부 = [O/X]
First network request to data visible: ___ms (총 소요)

[측정 후 — RSC + prefetch]
LCP: ___ms
Network waterfall: /api/products/:id 발생 여부 = [O/X]
First network request to data visible: ___ms
```

---

## OPT-3 — ISR (Incremental Static Regeneration)

### 왜 선택했는가
상품 상세 페이지는 읽기가 압도적으로 많고 쓰기는 드물다.  
매 요청마다 DB를 조회하는 대신 정적 캐시로 응답하면 서버 부하와 TTFB를 동시에 줄인다.

대안과 비교:
- `revalidate: 0` (항상 동적): 매 요청마다 EC2 호출 → TTFB 높음
- `revalidate: 3600` (1시간): 가격/재고 변경이 늦게 반영 → 위험
- **`revalidate: 300` (5분)**: 균형점. 가격은 최대 5분 지연 허용

잘못 적용하면:
- `revalidate` 값이 너무 길면 재고 0 처리 지연 → 사용자가 품절 상품 결제 시도
- 해결책: 백엔드에서 재고 0 전환 시 Route Handler로 `revalidateTag('product-123')` 호출

### 적용 위치
- `frontend/src/app/(main)/products/[id]/page.tsx`
  ```tsx
  export const revalidate = 300; // 5분마다 백그라운드 재생성
  ```
- `serverGet` 호출 시 `tags: ['product-${id}']` 적용 (온디맨드 revalidation 준비)

### 측정 방법 (브라우저 기반)
**브라우저만으로 측정 가능**
1. DevTools > Network > `/products/123` HTML 요청 선택
2. `Timing` 탭 → `Waiting (TTFB)` 값 확인
3. 첫 방문: TTFB 높을 수 있음 (캐시 MISS)
4. 두 번째 방문 (5분 이내): TTFB < 50ms (Vercel Edge 캐시 HIT)

**응답 헤더로 캐시 상태 확인:**
- `x-vercel-cache: HIT` → 캐시 히트
- `x-vercel-cache: MISS` → 캐시 미스 (최초 방문 또는 revalidate 후)

### 측정 결과 기록란
```
[첫 방문 — 캐시 MISS]
TTFB: ___ms
x-vercel-cache: MISS

[두 번째 방문 — 캐시 HIT]
TTFB: ___ms
x-vercel-cache: HIT
개선율: ___% 단축
```

---

## OPT-4 — SSR prefetchQuery (상품 목록 페이지)

### 왜 선택했는가
`products/page.tsx`는 RSC였지만 실제 데이터 요청은 CC인 `ProductsClient`가 마운트 후 실행했다.  
이 구조의 문제: 첫 방문 시 그리드 자리에 스켈레톤이 보임 → FCP에 실제 상품이 없음.

URL의 searchParams를 서버에서 읽어 첫 페이지 데이터를 prefetch하면, 클라이언트 마운트 직후 상품 그리드를 즉시 표시할 수 있다.

대안과 비교:
- 순수 SSG: 필터/정렬이 있으면 불가
- **SSR prefetch + HydrationBoundary**: 현재 선택. URL 파라미터 기반이라 모든 필터 조합에 대응

### 적용 위치
- `frontend/src/app/(main)/products/page.tsx` — async RSC, searchParams 파싱, prefetchQuery, HydrationBoundary
- `frontend/src/app/(main)/products/ProductsClient.tsx` — `ProductGridSkeleton` export 추가 (Suspense fallback용)

### 성능 개선 포인트
| | 이전 | 이후 |
|--|-----|-----|
| Suspense fallback | `null` (빈 화면) | `ProductGridSkeleton` (레이아웃 힌트) |
| 클라이언트 마운트 후 | API 요청 발생 | 캐시 히트 → 즉시 그리드 표시 |
| FCP 콘텐츠 | 스켈레톤 | 실제 상품 카드 |

### 측정 방법 (브라우저 기반)
**브라우저만으로 측정 가능**
1. Lighthouse > "Slow 4G" > FCP 값 기록
2. DevTools > Network > `/api/products?...` 요청 시점 확인
   - 이전: HTML 로드 후 클라이언트에서 요청
   - 이후: 요청 없음 (이미 캐시에 존재)

### 측정 결과 기록란
```
[측정 전 — 클라이언트 fetch]
FCP: ___ms
/api/products?... 요청 발생 여부 = O
스켈레톤 → 실데이터 전환 시간: ___ms

[측정 후 — SSR prefetch]
FCP: ___ms
/api/products?... 요청 발생 여부 = X
스켈레톤 → 실데이터 전환 시간: 0ms (즉시)
```

---

## OPT-5 — useDeferredValue / useTransition (필터·정렬 인터랙션)

### 왜 선택했는가
카테고리 탭 클릭 시 React가 전체 상품 그리드를 재렌더하는 동안 버튼 UI가 즉각 반응하지 않는 느낌이 있었다.

디바운싱(이미 적용)과의 차이:
- 디바운싱: 입력값 자체를 N ms 지연
- `useDeferredValue`: 입력은 즉각, **비싼 렌더링을 낮은 우선순위로 처리**

`useTransition`을 함께 적용하여:
- 탭/버튼 클릭 → 즉각 활성 스타일 변경 (`isPending=false`)
- 상품 그리드 교체 → 우선순위 낮게 처리 (React가 더 중요한 업데이트 먼저 처리)
- 전환 중 그리드 opacity 60% → CLS 없이 "로딩 중" 시각화

잘못 적용하면:
- `useDeferredValue`를 검색 입력 debounce 대신 오해하고 중복 적용 → 혼란
- 모든 상태에 적용 → 의존성 배열 복잡도 증가

### 적용 위치
- `frontend/src/app/(main)/products/ProductsClient.tsx`
  - `useDeferredValue(categoryId, sortBy, sortOrder, page, keyword)`
  - `useTransition()` + `startTransition(() => router.push(...))`
  - `isPending`을 그리드 opacity에 반영

### 측정 방법 (브라우저 기반)
**브라우저만으로 측정 가능 (단, CPU throttling 필수)**
1. DevTools > Performance > CPU: 4x slowdown 설정
2. 녹화 시작 → 카테고리 탭 클릭 → 녹화 종료
3. `Interactions` 트랙에서 이벤트 지속 시간 확인 (INP 지표)

**콘솔 측정 방법:**
```javascript
// DevTools 콘솔에서 실행
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.interactionId) {
      console.log(`INP: ${entry.duration}ms`, entry.name);
    }
  }
}).observe({ type: 'event', buffered: true });
```

**"좋음" 기준:**
- INP ≤ 200ms: 좋음
- INP 200~500ms: 개선 필요
- INP > 500ms: 나쁨

### 측정 결과 기록란
```
[측정 전 — useTransition 없음, CPU 4x throttling]
카테고리 탭 클릭 INP: ___ms
정렬 버튼 클릭 INP: ___ms

[측정 후 — useDeferredValue + useTransition]
카테고리 탭 클릭 INP: ___ms
정렬 버튼 클릭 INP: ___ms
```

---

## OPT-6 — staleTime 전략 (데이터 특성별 캐시 유효 시간)

### 왜 선택했는가
`QueryClient` 기본 `staleTime: 60_000`은 모든 쿼리에 동일하게 적용된다.  
쇼핑몰에서 데이터 특성은 다양하다:
- 카테고리: 거의 안 바뀜 → `staleTime: 5분` (이미 설정됨)
- 상품 목록: 신상품/변경 가능 → `staleTime: 1분`
- 상품 상세: ISR과 일치 → `staleTime: 5분`
- 장바구니: 낙관적 업데이트로 관리 → `staleTime: 5분` (뮤테이션이 invalidation 담당)
- 주문: 상태 변화 가능 → `staleTime: 30초` (이미 설정됨)

**staleTime 설정이 없으면 발생하는 문제:**
- 동일 화면에서 컴포넌트 마운트마다 네트워크 요청 폭발
- 뒤로가기 후 재진입 시 매번 로딩 스켈레톤 표시

### 적용 위치
- `frontend/src/lib/react-query/products-query-options.ts` — `staleTime: 60_000` (목록), `300_000` (상세)
- `cart-query-options.ts`, `order-query-options.ts` — 이미 적용 완료 상태 확인

### 측정 방법 (브라우저 기반)
**브라우저만으로 측정 가능**
1. DevTools > Network > 필터: Fetch/XHR
2. 상품 목록 → 상세 → 뒤로가기 → 재진입
3. `이전(staleTime: 0)`: 매번 `/api/products?...` 요청 발생
4. `이후(staleTime: 60s)`: 1분 이내 재진입 시 요청 없음

**React Query DevTools로 시각 확인:**
- 쿼리 상태 `fresh` (녹색): staleTime 이내
- 쿼리 상태 `stale` (노란색): staleTime 초과, 다음 마운트 시 refetch

### 측정 결과 기록란
```
[측정 전 — staleTime 미설정]
상품 목록 진입 후 즉시 재진입 시 API 요청 수: ___회

[측정 후 — staleTime 60s]
동일 조건 API 요청 수: 0회 (캐시 히트)
```

---

## OPT-7 — next/image 마이그레이션

### 왜 선택했는가
기존 `<img>` 태그는:
1. 원본 이미지 크기 그대로 다운로드 (2MB JPEG → 200KB WebP 미변환)
2. `srcset` 없음 → 모바일에서도 데스크탑 해상도 이미지 수신
3. LCP 이미지에 preload 힌트 없음 → 늦은 발견
4. `loading="lazy"` 수동 설정 필요

`next/image`는 이 모든 것을 자동 처리한다.

대안과 비교:
- `<img loading="lazy" decoding="async">`: 일부 개선이지만 포맷 변환/CDN 캐시 없음
- 외부 CDN (CloudFront + Lambda@Edge): 강력하나 인프라 추가 비용 및 복잡도

잘못 적용하면:
- 모든 이미지에 `priority={true}`: preload 과다 → 오히려 중요 리소스 경쟁 발생
- `sizes` 미설정: Next.js가 가장 큰 사이즈 이미지를 내려받도록 srcset 생성 → 비효율
- 외부 도메인이 `remotePatterns`에 없으면 빌드 에러

### 적용 위치
1. `frontend/src/components/home/ProductCard.tsx`
   - `<img>` → `<Image fill sizes={...} priority={...} />`
   - `priority` prop 추가 (기본값 false, 첫 4개 카드는 true)
   - `sizes`: 그리드 레이아웃 기반 반응형 값

2. `frontend/src/app/(main)/products/[id]/ProductGallery.tsx`
   - 메인 이미지: `<Image fill priority sizes="..." />`
   - 썸네일: `<Image fill sizes="..." />` (priority 없음)

3. `frontend/next.config.js`
   - `images.remotePatterns`: `http://**`, `https://**` 설정
   - (EC2 이미지 URL이 HTTP이므로 http 패턴 필수)

### 측정 방법 (브라우저 기반)
**브라우저만으로 측정 가능**

**방법 1 — 이미지 포맷 확인:**
1. DevTools > Network > Img 필터
2. 상품 이미지 요청 클릭 → Headers > Response > `Content-Type`
3. `이전`: `image/jpeg` 또는 `image/png`
4. `이후`: `image/webp` (Vercel 이미지 최적화 통과 시)

**방법 2 — LCP 측정:**
1. Lighthouse > Slow 4G > Performance
2. "Largest Contentful Paint element" 섹션에서 LCP 이미지 확인
3. `이전`: preload 없음 (`<link rel="preload">` 부재)
4. `이후`: preload 존재 → LCP 단축

**방법 3 — preload 확인:**
1. DevTools > Elements > `<head>` 태그
2. `<link rel="preload" as="image" href="...">` 존재 여부 확인

### 측정 결과 기록란
```
[측정 전 — <img> 태그]
LCP: ___ms (상품 상세 기준)
이미지 응답 Content-Type: image/jpeg
ProductCard 이미지 평균 크기: ___KB
메인 이미지 크기: ___KB
<link rel="preload"> 존재 여부: X

[측정 후 — next/image]
LCP: ___ms
이미지 응답 Content-Type: image/webp
ProductCard 이미지 평균 크기: ___KB (절감율: __%)
메인 이미지 크기: ___KB (절감율: __%)
<link rel="preload"> 존재 여부: O
```

---

## OPT-8 — preconnect (외부 도메인 연결 선행)

### 왜 선택했는가
PortOne 결제 SDK는 페이지 로드 시 외부 CDN(`cdn.portone.io`)에서 JS를 로드한다.  
이 때 DNS 조회 + TCP 핸드셰이크 + TLS 협상에 100~300ms가 소요될 수 있다.

`<link rel="preconnect">`를 HTML 파싱 초기에 배치하면, 브라우저가 메인 리소스를 처리하는 동안 연결을 병렬로 맺는다.

대안: `<link rel="dns-prefetch">` — DNS만 미리 해결, preconnect보다 가볍지만 효과가 작음  
→ preconnect + dns-prefetch를 함께 사용하여 지원되지 않는 브라우저 fallback 처리

### 적용 위치
- `frontend/src/app/layout.tsx` — `<head>` 내에 preconnect/dns-prefetch 링크 4개 추가

### 측정 방법 (브라우저 기반)
**브라우저만으로 측정 가능**
1. DevTools > Network > 도메인으로 필터: `portone`
2. 첫 번째 PortOne 리소스 클릭 → `Timing` 탭
3. `DNS Lookup` + `Initial connection` + `SSL` 시간 확인
4. `이전`: 세 단계 합산 100~300ms
5. `이후`: 세 단계가 거의 없거나 < 5ms (연결이 미리 맺어져 있으므로)

### 측정 결과 기록란
```
[측정 전 — preconnect 없음]
cdn.portone.io DNS Lookup: ___ms
Initial connection: ___ms
SSL: ___ms
합계: ___ms

[측정 후 — preconnect 적용]
합계: ___ms
절감: ___ms
```

---

## 종합 측정 가이드

### Lighthouse 측정 절차 (표준)

```
1. Chrome 시크릿 창 열기 (확장프로그램 영향 제거)
2. DevTools (F12) > Lighthouse 탭
3. 설정:
   - Mode: Navigation
   - Device: Mobile (또는 Desktop)
   - Categories: Performance만 체크
4. "Analyze page load" 클릭
5. 측정 3회 후 중간값 사용 (편차 있음)
```

### 각 지표 "좋음" 기준 (Core Web Vitals 2024)

| 지표 | 좋음 | 개선 필요 | 나쁨 |
|------|-----|---------|-----|
| LCP | ≤ 2.5s | 2.5~4s | > 4s |
| FCP | ≤ 1.8s | 1.8~3s | > 3s |
| CLS | ≤ 0.1 | 0.1~0.25 | > 0.25 |
| INP | ≤ 200ms | 200~500ms | > 500ms |
| TTFB | ≤ 800ms | 800ms~1.8s | > 1.8s |

### Throttling 설정 (재현 가능한 테스트 환경)
- **Slow 4G 시뮬레이션**: Lighthouse 내장 (가장 표준)
- **CPU 4x slowdown**: DevTools > Performance > 톱니바퀴

### 비교 촬영 방법
```
최적화 전 측정:
  git stash (또는 최적화 전 브랜치)
  yarn nx build frontend && yarn nx start frontend
  Lighthouse 측정 → 스크린샷 저장

최적화 후 측정:
  git stash pop (또는 최적화 후 브랜치)
  yarn nx build frontend && yarn nx start frontend
  Lighthouse 측정 → 스크린샷 저장
```

---

## Nx 모노레포 환경 특이사항

### 빌드 캐시 활용
```bash
# affected: 변경된 프로젝트만 빌드 (CI 시간 절감)
yarn nx affected -t build

# 캐시 초기화 (이상 동작 시)
yarn nx reset
```

### Bundle Analyzer와 Nx
```bash
# Nx로 analyze 스크립트 실행 시
ANALYZE=true yarn nx build frontend
# 또는 직접
cd frontend && ANALYZE=true npx next build
```

### Vercel 배포에서 모노레포 최적화
- `nx-ignore` 스크립트를 Vercel의 "Ignored Build Step"에 설정하면
  `frontend/` 변경 없는 커밋은 빌드 스킵 (빌드 분 절약)

---

*이 문서는 실제 측정 후 "측정 결과 기록란"을 채워 포트폴리오 자료로 활용.*
