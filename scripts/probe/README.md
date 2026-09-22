# 프론트 프로브 — 깨진 API 응답으로 컴포넌트를 재현한다

헤드리스 Chrome 으로 페이지를 열고 **특정 API 응답만 브라우저 안에서 바꿔**(Playwright `page.route`) 컴포넌트가 던지는지 본다.
서버·DB 는 아무것도 바뀌지 않는다 — 가로챈 요청은 서버에 닿지 않는다.

- 재료가 된 배경: Ops Companion 학습 노트 [7편 3-2](../../docs/learning/ops-companion/07-frontend-sourcemaps-and-eval-set.md) · 저장소로 옮긴 이유: [9편](../../docs/learning/ops-companion/09-closing-the-loop.md)
- 케이스 5개 = 앱이 찾고 사람이 승인한 프론트 버그 5건(사실 메모 `backend/eval/ops-incident-notes.ts`)

```bash
# 로컬 (프론트 3000 · 백엔드 4000 이 떠 있어야 한다)
node scripts/probe/probe.mjs
node scripts/probe/probe.mjs --case images-string --headed

# 운영 — 수정 후에만. Sentry 에 새 이벤트가 안 생기는지 볼 때 --allow-sentry
node scripts/probe/probe.mjs --base https://<vercel 도메인> --api https://<vercel 도메인>/api --allow-sentry --json probe-prod.json
```

| 케이스 | 깨뜨리는 응답 | 수정 전 | 수정 후 확인 |
|---|---|---|---|
| `categories-object` | `/categories` → `{ phase6: … }` | `t is not iterable` | 홈이 그려진다 |
| `products-null-item` | `/products?…` → `{ data: [null] }` | `null.id` | "상품이 없습니다" |
| `products-string-data` | `/products?…` → `{ data: 'oops' }` | `x.map is not a function` | "상품이 없습니다" |
| `images-string` | 상품 하나의 `images` 가 문자열 | `a.find is not a function` | 기본 이미지 카드 |
| `related-string` | 상세 페이지의 `/products?…` → `{ data: 'oops' }` | `.filter is not a function` | 연관 상품 섹션이 조용히 빠진다 |

판정: `BROKEN`(기대한 에러가 났다) · `OK`(에러 없음 → 수정 후 화면 확인까지) · `NO_HIT`(가로챈 요청 0 — 그 페이지는 서버 컴포넌트가 받는다, 7편 6-4).

주의: `playwright-core` 는 브라우저를 내려받지 않고 설치된 Google Chrome 을 쓴다. Sentry 전송(`/monitoring` 터널)은 기본 차단이다 — 로컬 프로브가 운영 Sentry 에 이벤트를 만들지 않게.
