# 번들 비교 측정 + 접근성 B안 (측정 → 핵심 흐름 수정 → 재측정)

> 포트폴리오 "아쉬운 점" 2건(Dynamic import 전후 번들 미측정 · 접근성이 ARIA 수준)을 숫자로 닫는다.
> 착수 2026-09-29.

---

## 1. Dynamic import 전후 번들 비교 — ✅ 완료(2026-09-29)

### 대상
관리자 대시보드 차트 3개가 `echarts-for-react` 를 `next/dynamic(..., { ssr: false })` 로 불러온다.
- `frontend/src/app/(admin)/admin/dashboard/components/OrderTrendChart.tsx`
- `.../SecurityChart.tsx`
- `.../FunnelChart.tsx`

### 방법
1. 현재 상태(dynamic) 그대로 `yarn nx build frontend --skip-nx-cache` → 빌드 출력의 라우트 표 저장.
2. 세 파일만 임시로 `import ReactECharts from 'echarts-for-react'`(정적)로 바꿔 같은 명령으로 빌드.
3. 두 라우트 표를 `diff` → 변경은 `git checkout` 으로 되돌림(커밋 없음).

Next 15.2.9, 프로덕션 빌드. 빌드 출력의 크기는 **gzip 기준**.

### 결과

| `/admin/dashboard` | 정적 import | dynamic import | 차이 |
|---|---|---|---|
| 페이지 고유 JS(Size) | 344 kB | **7.37 kB** | −336.6 kB |
| **First Load JS** | 598 kB | **261 kB** | **−337 kB (−56%)** |

- 두 빌드의 라우트 표 44줄 중 **바뀐 줄은 `/admin/dashboard` 한 줄뿐**이다. 다른 라우트와 공용 JS(223 kB)는 그대로다.
- dynamic 빌드에서 ECharts 는 별도 청크 `3652.*.js`(원본 1,038 kB / **gzip 337 kB**)로 분리돼 있다. 줄어든 337 kB 와 정확히 일치하므로, 빠진 크기가 모두 ECharts 라는 근거가 된다.
- 해석: ECharts 가 없어진 것이 아니다. **첫 화면 로드(First Load)에서 빠져**, 페이지가 뜬 뒤 차트 자리에서 따로 내려받는다.

### 과장 없이 적을 것
- `ssr: false` 의 원래 목적은 **SSR 에러 방지**(ECharts 가 `window`/canvas 에 의존)이고, 번들 절감은 그 결과로 따라온 효과다.
- 관리자 페이지 한 곳에만 해당한다. 구매자 첫 화면 성능과는 관계없다.
- 이번 측정은 전송 크기뿐이다. LCP/TBT 같은 체감 지표는 재지 않았다(선택 과제).

포트폴리오 한 줄:
> ECharts(gzip 337 kB)를 `next/dynamic` 으로 분리해 관리자 대시보드 First Load JS 598 → 261 kB(−56%) — 정적 import 빌드와 라우트 표 diff 로 측정

---

## 2. 접근성 B안 — ✅ 완료(2026-09-29, 수정·재측정·NVDA 청취)

### "ARIA 수준" 이 뜻하는 것
속성(`aria-*`, `role`)은 달았지만 **키보드·포커스·실사용 검증이 없다**는 뜻이다. 현재 `frontend/src` 20개 파일에 29곳이 있다.
대표 사례가 `components/common/Modal/Modal.tsx` 다.
- 있음: `role="dialog"`, `aria-modal="true"`, `aria-label={title}`, 닫기 버튼 `aria-label`, Esc 닫기
- 없음: 열릴 때 **포커스를 모달 안으로 옮기기**, Tab 이 모달 밖으로 새지 않게 하는 **포커스 가두기**, 닫힐 때 **여는 버튼으로 포커스 복귀**
- 결과(추정, 측정으로 확인 예정): 키보드 사용자가 모달을 열어도 포커스는 뒤 페이지에 남는다. 스크린리더는 `aria-modal` 로 뒤를 가렸다고 안내받는데, 실제 포커스는 그 가려진 곳에 있다.

### 범위
구매 흐름 하나만 다룬다. **홈 → 상품 상세 → 장바구니 → 주문서 → (결제창 직전)**, 그리고 이 흐름에서 쓰는 공용 컴포넌트(Header·Modal·Button·Select·폼).
관리자·셀러 화면은 제외한다.

### 단계
| 단계 | 할 일 | 산출물 |
|---|---|---|
| A-1 자동 측정 | Playwright(`playwright-core` + 설치 Chrome, `scripts/probe/` 방식) 로 각 페이지에 `axe-core`(node_modules 에 이미 있음)를 주입해 위반 목록 JSON 수집. Lighthouse 접근성 점수도 같이 기록 | 페이지별 위반 수·심각도 표(before) |
| A-2 수동 측정 | 키보드만으로 흐름 완주 시도(Tab/Shift+Tab/Enter/Space/Esc). 막히는 지점, 포커스가 안 보이는 지점, 순서가 이상한 지점 기록 | 키보드 막힘 목록(before) |
| B 수정 | 아래 표의 요소별로 수정. 공용 컴포넌트 먼저(한 번 고치면 전 페이지에 반영) | 커밋 단위 = 요소 단위 |
| C 재측정 | A-1·A-2 재실행 + NVDA 로 흐름 1회 청취 | before/after 표 |

### 측정 도구 (저장소 `scripts/a11y/`, 수정 전/후 같은 스크립트)
| 스크립트 | 무엇을 | 왜 따로 |
|---|---|---|
| `axe-audit.mjs` | 6페이지(홈·상품 목록·상품 상세·로그인·장바구니·주문서)에 axe-core 4.11 주입, WCAG 2.1 A/AA 태그만 | 자동 검사 기준선 |
| `keyboard-walk.mjs` | 페이지마다 Tab 을 눌러 가며 정지 수·이름 없는 요소·**포커스 표시가 화면에 보이는지**(포커스/해제 스크린샷 비교)·마우스 전용 요소 | axe 는 키보드·포커스를 거의 못 본다 |
| `modal-focus.mjs` | 주문 상세 "주문 취소" 모달을 키보드로 열고 닫으며 ①이동 ②가두기 ③Esc ④복귀 | 모달은 axe 로 못 잰다 |
| `lib.mjs` | 측정 계정 API 토큰·장바구니 1개 보장 | 주문서는 빈 장바구니면 튕긴다 |

전제: 로컬 백엔드 4000 + 프론트 **운영 빌드** 3000(`NEXT_PUBLIC_API_URL=/api` — 로컬 `.env` 의 `http://localhost:4000/v1` 은 운영 CSP `connect-src 'self'` 에 막힌다. Git Bash 에서 `/api` 를 넘기면 `C:/Program Files/Git/api` 로 바뀌므로 **PowerShell 에서 빌드**). 측정 계정 `a11y-buyer@test.local` 은 로컬 DB 에만 있다. Sentry 전송은 스크립트가 차단한다.

측정 방법에서 틀렸다가 고친 것 2가지(결과를 믿을 근거):
- 포커스 표시를 계산 스타일로 판정했더니 0건 → Tailwind 가 투명 `box-shadow`·`outline: 2px solid transparent` 를 깔아 "있음"으로 셌다. 알파를 보게 고치자 이번엔 로그인 입력칸이 "없음" → 실제론 `transition 150ms` 도중 값을 읽은 것이었다. **최종 판정은 스크린샷 비교**(포커스 상태 vs blur 상태 픽셀이 다르면 표시 있음) — 이 방식으로 **포커스 표시 없음은 수정 전부터 0건**, 즉 문제가 아니었다.
- 로그인 후 페이지를 주소로 직접 열면 로그인으로 튕긴다(아래 §3 별도 버그) → 헤더 링크·버튼 클릭으로 이동.

### 수정 전(before) 실측 — 2026-09-29
**axe (WCAG 2.1 A/AA)** — 6페이지 모두 위반, 페이지별 규칙 위반 11건·요소 24개
| 페이지 | critical | serious | 요소 |
|---|---|---|---|
| 홈 | 1 (`select-name`) | 1 (대비) | 2 |
| 상품 목록 | 1 | 1 | 2 |
| 상품 상세 | 1 | 1 | 7 |
| 로그인 | 0 | 1 | 3 |
| 장바구니 | 1 | 1 | 6 |
| 주문서 | 1 | 1 | 4 |

**키보드** — 본문 첫 요소까지 모든 페이지에서 헤더 **Tab 15회**(건너뛰기 링크 없음, 구매자 화면에 `<main>` 자체가 없음). 헤더 "카테고리" 버튼은 Enter 를 눌러도 아무 일이 없음(hover 전용) → **하위 카테고리(의류 › 봄 등)는 키보드로 도달 불가**. 페이지 이동 요소(로고·HOME·카테고리 바·상단 바·장바구니)가 전부 `<button onClick={router.push}>`.

**Modal**(주문 취소) — ① 열린 직후 포커스 **모달 밖**(연 버튼에 그대로) ② Tab 8회 중 **8회가 모달 뒤 푸터 링크로** 샘 ③ Esc 닫힘 ✓ ④ 닫힌 뒤 포커스 복귀 **✗**.

### 요소별 기록표
| 요소 | 현재 부족한 점(측정 근거) | 고치는 방법 | 결과(재측정) |
|---|---|---|---|
| 구매자 레이아웃 | `<main>` 없음, 본문까지 Tab 15회 | "본문으로 건너뛰기" 링크(포커스 시에만 보임) + `<main id tabIndex=-1>` | 본문까지 Tab **15 → 2회**(건너뛰기 → Enter → 다음 Tab 이 본문 첫 요소) |
| 헤더 검색 `select` | 이름 없음 — axe **critical**, 6페이지 전부 | `aria-label="검색할 카테고리"`, 입력칸 `aria-label="검색어"`(placeholder 는 입력하면 사라짐), 검색 영역 `role="search"` | axe critical **5페이지 → 0** |
| 헤더 "카테고리" 드롭다운 | hover 전용, 항목이 `div onClick` → 키보드로 열 수도 고를 수도 없음 | disclosure 버튼(`aria-expanded`·`aria-controls`, Enter/Space 토글, 마우스 클릭은 열기만) + 항목을 `<Link>` 로 + 항목에 포커스가 있으면 하위 목록 펼침 + Esc 로 닫고 버튼으로 복귀 + 포커스가 밖으로 나가면 닫힘 | Enter → `aria-expanded=true` → Tab "의류 (하위 카테고리 4개)" → Tab "봄" → Enter 로 `?categoryId=2` 이동 · Esc 로 닫히고 포커스 버튼 복귀 ✓ |
| 이동 요소(로고·HOME·카테고리 바·상단 바·로그인) | `button` + `router.push` → 스크린리더가 "버튼"으로 읽고 새 탭 열기 불가 | `<Link>` 로 교체(모양 유지 위해 `inline-block`) | Tab 정지 요소가 `a`(링크)로 읽힘 — 정지 수는 불변(80/72/52…) |
| 헤더 장바구니 | 고정 `aria-label="장바구니"` 가 보이는 "1개 담음 · 12,000원" 을 **덮어써** 개수·금액이 안 읽힘. 글자 대비 2.53:1 | 상태로 이름 생성(`장바구니, 1개 담음, 12,000원`) + 링크화 + `gray-500` | 이름 "장바구니, 비어있음" / "장바구니, 1개 담음, …원", 대비 위반 0 |
| 공용 Modal | 위 before 참고. 제목은 `aria-label` 복제 | 열 때 연 요소 기억 → 닫기 버튼 다음 첫 요소로 포커스 → Tab/Shift+Tab 순환 → 닫힐 때 복귀. `role="dialog"` 를 배경이 아닌 패널로, 이름은 `aria-labelledby`→`h2`. 단위 테스트 5건(`Modal.spec.tsx` — **수정 전 코드로 돌리면 3건 실패**) | ①모달 안 ✓ ②Tab 8회 중 샌 횟수 **8 → 0** ③Esc ✓ ④복귀 **✗ → ✓**, 이름 `labelledby`="주문 취소" |
| 주문서 입력 4칸 | `<label>` 이 보이지만 `htmlFor`/`id` 연결이 없어 이름이 placeholder("010-0000-0000")였다 — axe 는 placeholder 를 이름으로 인정해 **못 잡음** | `htmlFor`↔`id` 연결, `*` 는 `aria-hidden`(필수는 `required` 가 전달), `autoComplete`(name·tel·street-address, WCAG 1.3.5) | 키보드 측정의 입력칸 이름이 placeholder → label("수령인" 등) |
| 로그인·회원가입 폼(BaseForm) | 에러 문구가 입력칸과 끊겨 있어 틀린 칸으로 포커스가 가도 "왜 틀렸는지"가 안 읽힘. 제출 버튼 흰 글자 on `#50acd6` = 2.55:1 | `aria-invalid` + `aria-describedby`(도움말·에러 id), 로그인 실패 문구 `role="alert"`, 버튼 `sky-700`(5.9:1), 에러 `red-600` | 로그인 대비 위반 3 → 0 |
| 수량 버튼(상품 상세·장바구니) | 이름이 "−"/"+" — 여러 행이면 어느 상품인지도 모름. 누른 결과(수량)가 안 읽힘 | `aria-label`("(상품명) 수량 늘리기"), 수량 표시 `aria-live="polite"`, 삭제 버튼 이름에 상품명, 휴지통 아이콘 `secondary-300`→`500`(비텍스트 3:1) | Tab 정지 이름 "+"/"−" → "수량 늘리기"/"(상품명) 수량 늘리기" |
| 장바구니 담기 결과 | 버튼 글자만 "✓ 장바구니에 담았습니다"로 바뀜 → 스크린리더 무소식 | 늘 있는 `role="status"` 영역에 문구 | **NVDA 청취 통과** — "장바구니에 담았습니다" |
| 별점 | `★★★⯨☆` 글자 — "검은 별…"로 읽힘, ⯨ 글꼴 의존, 대비 1.53:1 | 별은 SVG 장식(`aria-hidden`), 숫자에 "평점 5점 만점에 … 점" | 상품 상세 대비 위반 해소(axe 0) |
| 메인 배너 | 3초 자동 넘김이 **마우스 hover 때만** 멈춤 → 키보드·스크린리더 사용자는 멈출 수 없음(WCAG 2.2.2, A). 클릭 동작 없는 `cursor-pointer` | 멈춤/재생 버튼 + 포커스가 들어오면 멈춤 + `prefers-reduced-motion` 이면 처음부터 멈춤 + 현재 점 `aria-current`, `cursor-pointer` 제거 | 멈춤 버튼으로 멈춘 뒤 4초간 슬라이드 1 → 1 유지, 버튼 이름 "…멈추기" → "…재생" ✓ |
| 흐린 회색 글자(대비) | `secondary-400`(#94a3b8)·`gray-400` on 흰색 = 2.5:1 등 serious 15곳 | 흐름 안 해당 글자만 `-500`(4.7:1+), 초록 `green-700/800` — 토큰 자체는 안 바꿈(전 화면 영향) | serious 6페이지 → **0** |

### 수정 후(after) 실측 — 2026-09-29, 같은 스크립트·같은 계정·운영 빌드
| 항목 | before | after |
|---|---|---|
| axe WCAG 2.1 A/AA 위반(6페이지) | 24곳 (critical 5페이지 · serious 6페이지) | **0** |
| 본문까지 Tab | 15회 | **2회** |
| Tab 정지 중 이름 없는 요소 | 6페이지 각 1(검색 select) | **0** |
| 마우스 전용 요소(cursor:pointer + Tab 불가) | 홈 3 | **0** |
| 포커스 표시 안 보이는 정지 | 0 | 0 (원래 문제 아님) |
| 헤더 카테고리 하위 목록 키보드 도달 | 불가 | 가능 |
| Modal ①이동 ②샘 ③Esc ④복귀 | ✗ · 8/8 · ✓ · ✗ | ✓ · 0/8 · ✓ · ✓ |
| 자동 넘김 배너 멈춤 | 마우스 hover 만 | 버튼·포커스·reduced-motion |

원본 JSON: `docs/roadmap/a11y/{axe,keyboard,modal}-{before,after}.json`.
검증: 프론트 tsc · 변경 파일 eslint 에러 0 · jest 6 스위트 45건(+ `Modal.spec.tsx` 5건, 수정 전 코드로는 3건 실패).

### 남은 한계 (과장하지 않기)
- 스크린리더 실청취는 **NVDA(Chrome) 3곳만** 확인했다(2026-09-29, 사용자): 상품 상세 수량 + → "2개", 장바구니 추가 → "장바구니에 담았습니다", 장바구니 행 + → "수량 2개" — 셋 다 통과. 자동 측정으로 못 보는 "말로 알려 주는 안내"(status/live)만 골라 들었다. 나머지 항목은 스크립트 확인이며 청취하지 않았다.
- axe 는 WCAG 기준의 일부(대략 3~4할)만 자동으로 본다. "axe 0" 은 "WCAG AA 준수"가 아니다.
- 배너 이미지는 글자가 들어간 이미지인데 `alt=""` — 템플릿 이미지라 대체 텍스트를 쓰지 않았다(1.1.1 미해결).
- 범위는 구매 흐름 6페이지 + 공용 컴포넌트. 관리자·셀러·마이페이지 나머지 화면은 측정하지 않았다(공용 Modal·BaseForm 수정 효과는 그쪽에도 간다).
- 푸터 링크는 `href="#"` 자리표시 — 이번 범위 밖.

포트폴리오 한 줄:
> 구매 흐름 6페이지를 axe-core + Playwright 키보드 스크립트로 측정(before 24곳 위반·모달 포커스 8/8 이탈·하위 카테고리 키보드 도달 불가) → 공용 컴포넌트 중심 수정 → 같은 스크립트로 재측정해 axe 위반 0·본문까지 Tab 15→2·모달 이탈 0. 모달 포커스 규칙은 단위 테스트로 고정, 동적 안내(장바구니 담기·수량 변경)는 NVDA 로 청취 확인.

### 완료 기준
- 흐름 페이지의 axe **critical/serious 위반 0**
- 키보드만으로 주문서까지 완주
- before/after 숫자 표를 이 문서에 남김

---

## 3. 부수 발견 — 로그인 페이지 새로고침 시 로그인으로 튕김 (미수정)
`/cart`·`/checkout`·`/my/orders/*` 를 로그인 상태에서 **주소로 직접 열거나 새로고침**하면 `/login` 으로 간다.
`AuthContext` 는 `isHydrated` 를 마운트 즉시 true 로 두고 `user` 는 `/auth/me` 응답 전까지 `undefined` → 페이지의 `if (isHydrated && !isLoggedIn) router.push('/login')` 가 응답 전에 발동(`cart/page.tsx:25`, `checkout/page.tsx:37`, `my/orders/page.tsx:50`). 고치려면 판정에 `isLoading` 을 함께 본다. 접근성 범위 밖이라 별도 작업.
