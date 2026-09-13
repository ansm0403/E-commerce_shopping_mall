# Phase 2-2 — 구매자 마이페이지

> 목표: 셀러·관리자 화면을 채우는 동안 비어 있던 **구매자 마이페이지 계층**을 실기능으로 채운다.
> 백엔드는 전부 완성돼 있으므로 **프론트 연결 중심**이며, 일부 라우트/메뉴 정리 과제를 함께 해소한다.

라우트 위치: `frontend/src/app/(main)/my/*`. 역할: `BUYER`(로그인 사용자).

---

## 0. 왜 지금 하는가

Phase 1·2로 셀러·관리자 화면은 정교해졌는데, **로그인한 사용자가 가장 먼저 누르는 마이페이지가 비어 있다.**
데모 동선상 첫인상을 결정하는 구간이라 우선순위가 후순위 화면(셀러 대시보드·카테고리)보다 높다.

또한 지금은 기능이 **반쪽**인 것들이 있다.
- 위시리스트: 상품 상세에서 **담을 수는 있는데**(`ProductInfo.tsx`) 담은 목록을 볼 화면이 없다.
- 문의: 상품 상세에서 **작성은 되는데** 내가 쓴 문의를 조회·삭제할 화면이 없다.

## 1. 현황 (코드로 확인한 사실)

### 1-1. stub 목록

| 파일 | 현재 | 백엔드 |
|---|---|---|
| `(main)/my/page.tsx` | 3줄 stub (`마이페이지 (프로필)`) | ✅ `GET /users/me` |
| `(main)/my/layout.tsx` | pass-through (children만 반환) | — |
| `(main)/my/wishlist/page.tsx` | 3줄 stub | ✅ `GET /wishlist` |
| `(main)/my/inquiries/page.tsx` | 3줄 stub | ✅ `GET /inquiries/my` |
| `(main)/my/password/page.tsx` | 3줄 stub | ✅ `PATCH /users/me/password` |
| `(main)/my/cart/page.tsx` | 3줄 stub | — (실제 장바구니는 `(main)/cart`) |

실구현된 것: `my/orders`(254줄) · `my/orders/[orderNumber]`(611줄) · `my/reviews`(184줄) · `my/seller-apply`.
**이 3개가 그대로 본보기다.**

### 1-2. 진입 경로가 없다

`components/header/topbar/UserMenu.tsx`의 메뉴 항목은 "내 정보 / 주문 목록 / 장바구니 / 셀러 / (관리자)"뿐이다.
- **`{ label: "내 정보", onClick: () => void 0 }` — 클릭해도 아무 일도 안 하는 죽은 항목이다.**
- 위시리스트·문의·비밀번호 변경으로 가는 링크가 **어디에도 없다.** 화면을 만들어도 도달할 수 없다.

### 1-3. `my/cart` 중복 라우트

실제 장바구니는 `(main)/cart`이고 UserMenu도 `/cart`로 보낸다. `my/cart`는 도달 불가능한 죽은 stub이다.

---

## 2-2-A. 필수

### ① 마이페이지 셸 — 레이아웃 + 홈
- **연계 백엔드**

  | 메서드/경로 | 역할 | 파일 |
  |---|---|---|
  | `GET /users/me` | 로그인 | `backend/src/user/user.controller.ts:17` |
  | `PATCH /users/me` | 로그인 | `user.controller.ts:23` (`@Auditable(PROFILE_UPDATED)`) |

  - 수정 가능 필드 = `backend/src/user/dto/update-profile.dto.ts` — `nickName`(2~20) · `phoneNumber`(10~15) · `address`(5~200), 전부 optional.
  - 응답 = `user-profile-response.dto.ts` — email · nickName · phoneNumber · address · isEmailVerified · roles[]. `password`는 `@Exclude()`.
- **변경 대상 (프론트)**
  - `service/user.ts` (신규): `getMyProfile()`, `updateMyProfile(dto)`
  - `hooks/user-query-options.ts` (신규)
  - `(main)/my/layout.tsx`: pass-through → **마이페이지 공통 셸**(좌측 네비: 주문·리뷰·위시리스트·문의·비밀번호·셀러신청 + 우측 content)
  - `(main)/my/page.tsx`: 프로필 카드(닉네임·이메일·인증여부·연락처·주소) + 인라인 수정 + 하위 화면 바로가기
- **산출물**: `/my` 진입 시 내 정보가 보이고 수정되며, 마이페이지 하위 화면으로 이동할 수 있다.

> ⚠ **착수 시 먼저 확인할 백엔드 결함**: `UserProfileResponseDto`가 `BaseModel`을 상속하면서 `id`·`createdAt`·`updatedAt`에
> `@Expose()`를 재선언하지 않았다. `Serialize` 인터셉터가 `excludeExtraneousValues: true`
> (`common/interceptors/serialize.interceptor.ts:47`)로 돌기 때문에 **이 3개 필드가 응답에서 통째로 누락된다.**
> `SettlementResponseDto`에서 똑같이 겪은 함정이다(§2-A④에서 BaseModel 상속 제거로 해결).
> 화면이 `id`를 필요로 하면 여기서 막히므로, 동일한 방식으로 정정할 것.

### ② 위시리스트
- **연계 백엔드**

  | 메서드/경로 | 역할 | 파일 |
  |---|---|---|
  | `GET /wishlist` | BUYER | `backend/src/wish-list/wish-list.controller.ts:35` (`BasePaginateDto`) |
  | `POST /wishlist/toggle` | BUYER | `wish-list.controller.ts:27` |
  | `DELETE /wishlist` | BUYER | `wish-list.controller.ts:44` |

  - ⚠ **`DELETE /wishlist`는 개별 삭제가 아니라 `clearAll`(전체 비우기)이다.** 개별 항목 제거는
    `POST /wishlist/toggle`로 처리해야 한다. UI에서 "전체 비우기"와 "이 상품 빼기"를 다른 호출로 붙일 것.
- **변경 대상 (프론트)**
  - `service/wishlist.ts` (**확장**): 현재 `toggleWishlist` 하나뿐 → `getWishlist(params)`, `clearWishlist()` 추가
  - `hooks/wishlist-query-options.ts` (신규) — 기존 `hooks/useWishlist.ts`(토글 mutation)와 공존
  - `(main)/my/wishlist/page.tsx`: 카드/목록 + 페이지네이션 + 개별 제거 + 전체 비우기 + 장바구니 담기
- **산출물**: 상품 상세에서 찜한 상품이 목록으로 보이고, 여기서 빼거나 장바구니로 넘길 수 있다.

### ③ 내 문의 관리
- **연계 백엔드**

  | 메서드/경로 | 역할 | 파일 |
  |---|---|---|
  | `GET /inquiries/my` | BUYER | `backend/src/inquiry/inquiry.controller.ts:55` |
  | `DELETE /inquiries/:id` | BUYER | `inquiry.controller.ts:66` |
- **변경 대상 (프론트)**
  - `service/inquiry.ts` (**신규 — 현재 프론트에 문의 service 레이어가 없다**)
  - `hooks/inquiry-query-options.ts` (신규)
  - `(main)/my/inquiries/page.tsx`: 내 문의 목록(상품 링크·비밀글 표시·답변 상태) + 답변 본문 표시 + 삭제
- **산출물**: 내가 쓴 문의와 셀러 답변을 한곳에서 확인·삭제할 수 있다.
  셀러 답변(`PATCH /seller/inquiries/:id/answer`)과 왕복이 성립한다.

### ④ 비밀번호 변경
- **연계 백엔드**

  | 메서드/경로 | 역할 | 파일 |
  |---|---|---|
  | `PATCH /users/me/password` | 로그인 | `user.controller.ts:33` (`@Auditable(PASSWORD_CHANGE)`) |

  - 입력 = `change-password.dto.ts` — `currentPassword` · `newPassword`(최소 8자).
- **변경 대상 (프론트)**
  - `service/user.ts`에 `changePassword(dto)` 추가
  - `(main)/my/password/page.tsx`: `components/forms/BaseForm.tsx`(react-hook-form) 재사용한 변경 폼
- **산출물**: 현재 비밀번호 확인 후 변경. 감사로그에 `PASSWORD_CHANGE`가 남는다(관리자 감사로그 화면에서 확인 가능).

### ⑤ 진입 경로 복구 (①~④가 도달 가능해지는 필수 조건)
- `components/header/topbar/UserMenu.tsx`
  - 죽은 항목 `{ label: "내 정보", onClick: () => void 0 }` → `/my`로 연결
  - 위시리스트·내 문의 항목 추가(비밀번호 변경은 마이페이지 네비에만 둬도 무방)
- **산출물**: 헤더 → 마이페이지 → 각 하위 화면까지 클릭만으로 도달.

---

## 2-2-B. 정리 과제 (같이 처리)

- **`(main)/my/cart` 삭제** — 도달 불가능한 중복 stub. 실제 장바구니는 `(main)/cart`.
  (외부 링크 우려가 있으면 삭제 대신 `/cart` redirect로 둘 것)
- `CLAUDE.md` §5의 "구매자 커머스 전 구간" 서술이 실제와 어긋나 있었으므로(마이페이지 계층 누락) 완료 후 갱신.

## 2-2-C. 범위 밖 (하지 않는 것)

- 회원 탈퇴 / 배송지 주소록 다건 관리 / 알림 설정 — 백엔드 엔드포인트가 없다. 필요해지면 별도 항목으로.
- 프로필 이미지 업로드 — 셀러 상품 이미지에서 겪은 `diskStorage` 유실 문제가 그대로 재현되므로 스토리지 전략 확정 후.

---

## 볼륨 (실측 기반 추정)

| 항목 | 예상 LOC | 난이도 |
|---|---|---|
| ① 셸(layout + 홈 + `service/user.ts` + hooks) | ~380 | 중 |
| ② 위시리스트 | ~340 | 하 |
| ③ 내 문의 | ~370 | 하 |
| ④ 비밀번호 변경 | ~150 | 하 |
| ⑤ 메뉴 복구 + 중복 라우트 정리 | ~40 | 하 |
| **합계** | **~1,280** | |

기준자: `my/orders`(254) · `my/orders/[orderNumber]`(611) · `my/reviews`(184) · 관리자 감사로그 1화면(897).
신규 기술 요소가 없고(파일 업로드·결제 같은 난관 없음) 백엔드가 전부 존재하므로, Phase 1-A②(상품 등록)보다 확연히 쉽다.

## 완료 기준 (DoD)

- 헤더 사용자 메뉴 → `/my` 진입 → 좌측 네비로 주문·리뷰·위시리스트·문의·비밀번호 전 화면 이동 가능.
- 상품 상세에서 찜 → `/my/wishlist`에 즉시 반영 → 거기서 제거·장바구니 담기 동작.
- 상품 상세에서 문의 작성 → `/my/inquiries`에 노출 → 셀러가 답변하면 답변이 보임 → 삭제 가능.
- 프로필(닉네임·연락처·주소) 수정과 비밀번호 변경이 동작하고, 각각 감사로그에 `PROFILE_UPDATED`·`PASSWORD_CHANGE`가 남는다.
- 3줄 stub이 `(main)/my/` 아래에 남아 있지 않다.
