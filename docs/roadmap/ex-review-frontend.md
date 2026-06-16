# 프론트 리뷰 기능 — 실행 계획 (ex- 트랙)

> **ex- 트랙**: 메인 시퀀스(셀러 → 관리자 → 인프라) 밖 삽입 작업. 이 문서는 *착수 전 실행 계획*이다.
> 백엔드 `ReviewService`/`InquiryService`는 구현돼 있으나 **프론트 리뷰 로직·UI는 전무**(껍데기뿐)였다 — 이를 실제 기능으로 채운다.
> 관련: [ex-ai-assistant.md](./ex-ai-assistant.md) Phase 5c(구매자 상품 리뷰 자동 요약)와 연계.
> 작성: 2026-06-16.

<br>

---

## 0. 한 줄 결론

상품 상세에 **실제 리뷰 목록 + 평점 분포 + (Phase 5c) AI 요약**을 노출하고, **구매확정 주문에서 리뷰 작성/수정/삭제**를 가능케 한다. 빈 별점 문제는 **목 리뷰 시드(전 상품 커버리지) + 시드 주문의 실제 상품 연결**로 해소한다.

<br>

---

## 1. 조사 결론 — 착수 시점의 사실

**프론트 리뷰 코드 현황 (전무에 가까움)**

| 영역 | 상태 |
|---|---|
| `service/review.ts`, `model/review.ts`, `hooks/useReview`, `review-query-options` | **전무** |
| `(main)/products/[id]/ReviewSection.tsx` | 평균/개수는 `product`에서 읽지만 **평점분포 하드코딩 예시값**, 목록은 "리뷰 없음" **정적 플레이스홀더**. API 호출 0 |
| `(main)/products/[id]/ProductTabs.tsx` | 탭 배선 존재(리뷰 탭 → ReviewSection) |
| `(main)/my/reviews/page.tsx` | `<div>내 리뷰 관리</div>` **stub** |
| 작성/수정/삭제 UI | **없음** |

**백엔드 API 표면 (이미 구현 — 그대로 소비)**
- `POST /v1/reviews` (BUYER) — `{orderId, productId, rating 1~5, comment, imageUrls?≤5}`. **구매확정(COMPLETED) 주문 + 주문에 포함된 상품 + 1회만**(unique `userId+productId+orderId`). `@Auditable(REVIEW_CREATED)`.
- `GET /v1/reviews/product/:productId` (공개, throttle 60/분) — 페이지네이션 목록. 응답 `{data: ReviewResponseDto[], meta}`.
- `GET /v1/reviews/my` (BUYER) — 내가 쓴 리뷰.
- `PATCH /v1/reviews/:id` (BUYER) — `{rating?, comment?, imageUrls?}`. **작성 30일 내만 수정 가능**(백엔드 강제).
- `DELETE /v1/reviews/:id` (BUYER/ADMIN).
- `ReviewResponseDto`: id/createdAt/updatedAt/userId/productId/orderId/rating/comment/imageUrls/`user{id,nickName}`.
- ⚠ **부재**: "평점 분포 집계"·"작성 가능(미작성) 항목" 엔드포인트 → §2에서 신설/우회.

**시드 인프라 (관련 사실)**
- `seed/dashboard.seed.service.ts`: `NODE_SEED=true`로만 동작, 멱등(audit 마커)·리셋(`SEED_RESET`). buyer 20명(`user1~20@seed.com`)·셀러 5명·주문(~30일치) 생성.
- ⚠ **시드 `order_items.product_id = 999999`(가짜)** + 가짜 이름. 코드 주석: `// FK 없음 — Phase 5 구현 시 실제 productId 로 교체`.
- 카탈로그(상품 ~300개)는 상시 시드 `common/seeds/product.seed.ts`. 상품 기본값 `reviewCount=0 / rating=null` → 현재 전 상품 빈 별점.
- `ReviewEntity`: `userId`는 users **FK(실제 유저 필요)**, `orderId`는 **FK 없는 단순 컬럼(합성값 가능)**. `getByProduct`는 `user`만 join(orderId 비노출).

<br>

---

## 2. 확정된 결정 (2026-06-16)

| # | 결정 | 내용 |
|---|---|---|
| Q1 | 리뷰 이미지 | **v1 텍스트+별점만**(`imageUrls` 빈 배열). 업로드는 후속(현재 프론트에 업로드 수단 없음). |
| Q2 | 평점 분포 | **백엔드 집계 엔드포인트 신설** — 가짜 막대를 실데이터로 교체. |
| Q3 | 작성 진입 | **주문 상세 구매확정 항목별 "리뷰 작성" 버튼**. |
| 시드 | 목 데이터 | **커버리지 리뷰 시드(전 상품) + 시드 주문 999999 → 실제 productId 교체**. |
| 시드 기본값 | 볼륨/분포 | 상품당 **3~8개**, rating **4~5 가중**, `NODE_SEED` 게이트, 카테고리/평점대별 한국어 템플릿. |

<br>

---

## 3. 백엔드 보강 (프론트의 전제 — 먼저)

### 3-A. 평점 분포 집계 엔드포인트
- `GET /v1/reviews/product/:id/summary` → `{ average, count, distribution: { 5,4,3,2,1 } }`.
- `ReviewService.getProductReviewSummary(productId)` — `createQueryBuilder ... GROUP BY rating`(집계 1쿼리). 공개 + throttle. 응답 전용 DTO 신설.

### 3-B. 커버리지 리뷰 시드 (`ReviewSeedService` 신설)
- 위치: 시드 체인(`NODE_SEED` 게이트) 안, **buyer 유저 시드 뒤**(userId FK 의존).
- 동작: 모든 published 상품 순회 → 3~8 리뷰 생성.
  - 작성자: 시드 buyer 20명에서 분산(상품당 유저 중복 금지 → 상품당 최대 20개).
  - `orderId`: **합성 unique 값**(FK 없음). rating: 4~5 가중(현실적). comment: 카테고리/평점대별 한국어 템플릿 풀.
  - 끝나고 상품 집계(`reviewCount/ratingSum/rating`) **일괄 재계산**(이벤트 미발행 경로이므로 직접).
- 멱등: 상품에 리뷰 있으면 skip. 리셋: `@seed.com` 유저 리뷰/마커 정리 연계.
- 효과: 300개 상품이 살아나고 **Phase 5c AI 요약도 요약 대상 확보**(MIN_REVIEWS=3 충족), §3-A 분포가 실데이터.

### 3-C. 시드 주문 999999 → 실제 productId 교체
- `seedOrdersAndEvents`의 `order_items` insert에서 product_id/이름/가격/이미지를 **실제 published 상품**에서 랜덤 선택.
- 효과: 시드 유저 로그인 → 내 주문(구매확정) → **"리뷰 작성" 버튼 실제 동작**(쓰기 흐름 시연). 기존 TODO 해소.
- 분리 원칙: 커버리지 시드(3-B)가 전 상품을 채우고(읽기/분포/요약), 완료주문(3-C)은 쓰기 흐름 시연용. **둘은 섞지 않는다**(리뷰 시드는 합성 orderId로 전 상품 커버).

<br>

---

## 4. 프론트 신규 파일 (기존 패턴 미러)

- `model/review.ts` — `Review`, `ReviewAuthor`, `PaginatedReviews`, `ReviewSummary`, `CreateReviewRequest`, `UpdateReviewRequest`.
- `service/review.ts` — publicClient: `getProductReviews(id, params)`, `getProductReviewSummary(id)` / authClient: `getMyReviews(params)`, `createReview(body)`, `updateReview(id, body)`, `deleteReview(id)`. (`service/wishlist.ts` 스타일)
- `lib/react-query/review-query-options.ts` — `reviewKeys`(all/product/summary/my) + `queryOptions`(`productReviews(id, params)`, `productSummary(id)`, `myReviews(params)`). (`order-query-options.ts` 스타일)
- `hooks/useReview.ts` — `useCreateReview/useUpdateReview/useDeleteReview`. onMutate 로그인 가드 + onError alert + 성공 시 `reviewKeys.product/summary/my` 무효화. (`hooks/useWishlist.ts` 스타일)
- `components/review/ReviewForm.tsx` — 별점 입력 + comment textarea. 생성/수정 공용. 공용 `Modal`에 표시.
- `components/review/ReviewItem.tsx` — 개별 리뷰 카드(별점·닉네임·날짜·본문).

<br>

---

## 5. 화면별 작업

1. **상품 상세 리뷰 탭** — `ReviewSection.tsx` 재작성
   - `productSummary` 쿼리 → 평균·개수·**실분포 막대**(하드코딩 제거).
   - `productReviews(page)` 쿼리 → 실제 목록 + 더보기/페이지.
   - 상단 **AI 요약 블록**(Phase 5c 연계 자리 — `GET /products/:id/review-summary`, `status` 뱃지). 5c 미구현 시 자리만.
   - 빈 상태(리뷰 0) graceful — 시드 후엔 거의 안 보임.
2. **주문 상세 작성 진입** — `(main)/my/orders/[orderNumber]/page.tsx` `ItemsCard`
   - `order.status==='completed'`일 때 항목별 "리뷰 작성" 버튼(orderId + item.productId) → `ReviewForm`.
   - 이미 쓴 항목은 `/reviews/my` 대조 → "리뷰 수정".
3. **my/reviews** — stub 구현
   - `myReviews` 쿼리 → 목록 + 각 항목 수정(30일 가드 surface)/삭제. 빈 상태 안내.

<br>

---

## 6. 권장 순서

1. 백엔드 §3 (A 분포 엔드포인트 → B 커버리지 시드 → C 999999 교체). **데이터 먼저 = 화면 검증 가능.**
2. `model/service/query-options/hooks`.
3. 상품 상세 리뷰 탭.
4. 주문 상세 작성 진입 + `ReviewForm`.
5. `my/reviews`.
6. (Phase 5c AI 요약 블록 연동 — [ex-ai-assistant.md](./ex-ai-assistant.md) Phase 5c 별도 트랙.)

<br>

---

## 7. 주의 / 엣지

- **30일 수정 제한**: 백엔드 강제 → 프론트도 `createdAt` 기준 버튼 비활성+안내(서버 400도 핸들).
- 작성은 **BUYER + 구매확정 주문**만 → 비로그인/비구매엔 진입점 미노출.
- 상품 상세는 **ISR/RSC 프리패치**(`revalidate=300`) → 리뷰는 탭 CC에서 **클라이언트 조회**(캐시 분리). 작성 후 `product.reviewCount`는 이벤트→집계지만 상세 ISR 캐시는 지연 가능(리뷰 목록/요약은 클라 쿼리라 즉시 반영).
- 시드 리뷰의 합성 `orderId`는 UI 비노출(`getByProduct`는 user만 join) — 안전.

<br>

---

## 8. 함수 매핑 / 트러블슈팅
> 구현하며 채운다(§7 규칙은 data-flow 문서 기준이며, 본 로드맵 문서엔 착수 후 핵심 파일 경로·이슈만 누적).

### 8-1. 구현 완료 (2026-06-16)

**백엔드 §3**
- §3-A 분포 엔드포인트: `GET /v1/reviews/product/:id/summary` →
  [review.controller.ts](../../backend/src/review/review.controller.ts) `getProductSummary`,
  [review.service.ts](../../backend/src/review/review.service.ts) `getProductReviewSummary`(GROUP BY rating 단일 쿼리),
  응답 DTO [review-summary-response.dto.ts](../../backend/src/review/dto/review-summary-response.dto.ts).
  ⚠ 라우트 순서: `product/:id/summary` 를 `product/:id` **앞**에 둬야 매칭 충돌이 없다.
- §3-B 커버리지 시드 + §3-C 실상품 풀: [review.seed.service.ts](../../backend/src/seed/review.seed.service.ts)
  (`seedCoverageReviews` / `loadPublishedProductPool` / `recalculateAllAggregates`).
  [seed.module.ts](../../backend/src/seed/seed.module.ts) 에 등록, [dashboard.seed.service.ts](../../backend/src/seed/dashboard.seed.service.ts) 가 호출.
- §3-C 999999 교체: `seedOrdersAndEvents` 가 `pickOrderItems(productPool)` 로 실제 published 상품을
  order_items 에 삽입(풀 비면 999999 폴백). reset 시 `@seed.com` 리뷰도 정리.
- 시드 결과(SEED_RESET): 커버리지 리뷰 1,882건/336상품, order_items 999999 = 0, 상품 집계 전건 정합,
  구매확정 주문 140건이 실상품 보유(쓰기 흐름 시연 가능). 런타임 검증: 작성→집계→삭제→재계산 정상.

**프론트**
- 데이터층: [model/review.ts](../../frontend/src/model/review.ts),
  [service/review.ts](../../frontend/src/service/review.ts),
  [lib/react-query/review-query-options.ts](../../frontend/src/lib/react-query/review-query-options.ts),
  [hooks/useReview.ts](../../frontend/src/hooks/useReview.ts).
- 컴포넌트: [components/review/ReviewForm.tsx](../../frontend/src/components/review/ReviewForm.tsx),
  [components/review/ReviewItem.tsx](../../frontend/src/components/review/ReviewItem.tsx).
- 화면: 상품상세 탭 [ReviewSection.tsx](../../frontend/src/app/(main)/products/[id]/ReviewSection.tsx)(분포 막대 실데이터 + 더보기),
  주문상세 [my/orders/[orderNumber]/page.tsx](../../frontend/src/app/(main)/my/orders/[orderNumber]/page.tsx)
  `ItemsCard`/`ItemReviewAction`(구매확정 항목별 작성/수정 + 30일 가드),
  [my/reviews/page.tsx](../../frontend/src/app/(main)/my/reviews/page.tsx)(목록·수정·삭제).
- AI 요약 블록: ✅ **Phase 5c 구현 완료(2026-06-16)** — `AI_REVIEW_SUMMARY_ENABLED=true`,
  별도 `useQuery`로 `GET /v1/products/:id/review-summary` 지연 로드(available:false 미표시 / stale·generating 뱃지 / fresh 요약). 백엔드·검증 상세는 ex-ai-assistant.md Phase 5c·§8-11.

### 8-2. 트러블슈팅 — 문서와 어긋난 사실 1건(수정함)

- **`ReviewResponseDto` 가 `id/createdAt/updatedAt` 를 응답에서 누락**(§1 표기와 불일치).
  원인: `@Serialize` 인터셉터가 `excludeExtraneousValues:true` 로 직렬화하는데
  `BaseModel`(id/createdAt/updatedAt)은 DTO에 `@Expose()` 가 없어 전부 탈락.
  영향: 프론트 수정/삭제(`PATCH·DELETE /reviews/:id` → `id` 필요)와 30일 가드(`createdAt` 필요)가 불가.
  조치: [review-response.dto.ts](../../backend/src/review/dto/review-response.dto.ts) 에 세 필드 `@Expose()` 재선언.
  (런타임 확인: 목록 응답에 `id/createdAt/updatedAt` 정상 노출.)

### 8-3. 엣지케이스 검증 (2026-06-16, 실 API)

백엔드 경계 17종 실요청 검증 — 모두 기대대로:
- 분포 집계: 리뷰 0개 상품 → `{average:0,count:0,분포 전부 0}`(200), 없는 상품 id → 동일(crash 없음), 숫자 아닌 id → 400.
- 목록: `take=100` 200 / `take=101` 400(상한 메시지).
- 작성: 비구매확정 주문 400, 주문 미포함 상품 400, 중복 400, rating 6/0 400, comment 누락 400, 무토큰 401.
- 수정: 본인 200 / 타인 403 / **31일 경과 400**(프론트가 `>30일` 버튼 비활성 + 이 400 메시지를 alert 로 미러).
- 삭제 후 상품 집계 자동 정정 확인. 검증 중 생성한 리뷰는 전부 삭제(잔존 0).

발견·수정한 프론트 버그 2건:
- **"더보기" 깜빡임**: `take` 를 키에 포함해 늘리면 새 키=캐시 없음 → 목록이 사라지며 로딩 표시.
  `review-query-options` 에 `placeholderData: keepPreviousData` 추가로 이전 목록 유지.
- **my/reviews `take` 상한 충돌**: 시드 buyer 일부가 리뷰 110건(>100) 보유 → "더보기"가 `take=110` 으로
  백엔드 상한(100)에 걸려 400. → my/reviews 를 **페이지 기반 이전/다음 네비**로 전환(삭제 시 페이지 클램프 포함).
  (상품 상세 ReviewSection 은 상품당 최대 8건이라 상한과 무관 — take 증가 유지.)

알려진 경미한 한계(미수정):
- 주문상세의 "작성/수정" 판별은 `/reviews/my?take=100` 를 받아 `orderId` 로 매칭. 실제 작성 리뷰는 항상
  최신(정렬 DESC 상단)이라 100건 안에 포함되지만, 이론상 리뷰 100건 초과 사용자에서 누락 가능.
  누락돼도 "작성" 클릭 시 서버가 중복 400 → alert 로 graceful 처리(데이터 손상 없음).
