# #1. NestJS + Next.js 15 풀스택 멀티 셀러 이커머스 플랫폼

---

## 개발 목적

구매자·판매자·관리자 3개 역할로 구성된 오픈마켓 이커머스 서비스를 설계하고,  
상품 등록부터 주문·결제(PortOne)·정산·관리자 대시보드까지 이커머스 전체 흐름을 혼자 구현했습니다.  
백엔드 API 설계에서 출발해 프론트엔드 아키텍처까지 직접 결정하는 과정을 통해  
서비스 전체를 하나의 흐름으로 이해하는 풀스택 개발 역량을 쌓는 것을 목표로 했습니다.

---

## 나의 역할

- **프론트엔드**: Next.js 15 App Router 기반 전체 구조 설계, RSC/CC 경계 설계, 성능 최적화, 배포
- **백엔드**: NestJS 기반 REST API 전 설계 및 구현 (인증, 상품, 주문, 결제, 정산, 감사 로그)
- **인프라**: Nx 모노레포 구성, Vercel 배포, AWS EC2 + Docker 운영 파이프라인 구축

---

## 기술스택

**프론트엔드**
Next.js 15 (App Router) / React 19 / TypeScript / TanStack Query v5 / Tailwind CSS

**백엔드**
NestJS / TypeScript / PostgreSQL / TypeORM / Redis / JWT / Docker

**모노레포 · 배포**
Nx 21 / Yarn 4 Workspace / Vercel / AWS EC2 (t3.small) / Docker Hub

---

## 배포 / GitHub

- **서비스**: https://shopping-mall-frontend-dusky.vercel.app
- **GitHub**: https://github.com/an-sangmoon/shopping_mall

---

## 프론트엔드 아키텍처 핵심 설계

### Nx 모노레포 구조
`backend / frontend / shared` 3개 프로젝트를 단일 저장소에서 통합 관리.  
`yarn nx affected -t build`로 변경된 프로젝트만 빌드해 CI 시간을 절감하고,  
`shared` 패키지에 공통 타입·유틸리티를 격리해 백엔드-프론트엔드 간 타입 일관성을 유지합니다.

### RSC + CC 이중 레이어 구조
- **RSC(서버)**: 상품 목록·상세 페이지를 서버에서 데이터 선처리 후 스트리밍. 초기 HTML에 실제 데이터 포함 → SEO·LCP 개선
- **CC(클라이언트)**: 필터, 정렬, 찜 토글 등 인터랙션 영역만 클라이언트 번들에 포함

### TanStack Query + HydrationBoundary
서버에서 `prefetchQuery`로 데이터를 캐시에 적재 → `HydrationBoundary`로 직렬화하여 클라이언트에 주입.  
마운트 직후 캐시 히트 상태로 시작하므로 추가 API 요청 없이 즉시 렌더링.

### 데이터 특성별 staleTime 차등 전략
| 데이터 | staleTime | 이유 |
|--------|-----------|------|
| 카테고리 | 5분 | 거의 변하지 않음 |
| 상품 목록 | 1분 | 신상품·재고 변화 가능 |
| 상품 상세 | 5분 | ISR revalidate 300s와 일치 |
| 주문 | 30초 | 상태 변화 빈번 |

### 401 Race Condition 방지
accessToken 만료 시 동시 다발 요청이 각각 401을 받아 refresh를 중복 호출하는 문제 해결.  
`isRefreshing` 플래그 + Promise queue 패턴으로 단일 refresh만 실행하고,  
이후 대기 요청은 해당 결과를 공유합니다.

### Vercel 서버사이드 프록시
EC2에 HTTPS/nginx를 별도 구성하는 대신 `next.config.js rewrites()`를 통해  
Vercel 서버가 EC2(HTTP)를 서버사이드에서 대신 호출.  
브라우저는 Vercel 도메인에만 요청하므로 CORS·mixed-content 이슈를 구조적으로 제거.

### 관리자 대시보드 이중 인증 가드
1. Edge Middleware: refreshToken 쿠키 존재 여부 즉시 확인 (Edge 실행, 0ms 지연)
2. SSR Layout: `/auth/me` 호출 후 `ADMIN` 역할 2차 검증

---

## 백엔드 주요 설계 (풀스택 이해도)

- **결제 동시성**: PortOne Webhook + 주문 취소 동시 도달 시 유령 결제 발생 → 트랜잭션 격리 수준 조정 + 주문 상태 선확인 후 결제 검증 순서로 해결
- **감사 로그 AOP**: `NestJS Interceptor` + `@Auditable()` 커스텀 데코레이터로 비즈니스 로직 수정 없이 61개 이상의 액션 자동 추적
- **멀티 셀러 배송 분리**: Order 단위가 아닌 Seller 단위로 Shipment 엔티티를 분리해 각 판매자 독립 배송 처리
