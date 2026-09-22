# 작업: Ops Companion Phase 8 — 코드 이름 대조 칩 + 실제 버그 수정으로 고리 닫기

> 2026-09-23 작성. 이력서 제출 전 **마지막 Phase** 다. 끝나면 README·포트폴리오 정리로 넘어간다(범위 밖).

## 한 문장 목표

**① AI 조치 코드에 나오는 이름을 실제 코드와 대조해 "코드에 없는 이름" 칩을 채점 카드에 붙여 사람의 판정을 돕고, ② 앱이 찾고 사람이 승인한 쇼핑몰 버그 6건을 실제로 고쳐 같은 조건 재현에서 오류 0건을 확인한 뒤, 앱에서 바로 해결 처리할 수 있게 한다.**

출발점은 Phase 7 재채점 결과다 — 사람은 방향이 틀린 답(CORS "허용 목록에 추가")은 반려했지만 **코드 이름을 지어낸 답은 통과**시켰다(#66 `FRONTEND_URL`, 별점 4→5). 이름 대조는 기계가 할 일이다. 결정은 여전히 사람이 한다 — 칩은 판정이 아니라 **근거**다(포트폴리오 방향: "AI 가 분석하고, 도구가 근거를 대고, 사람이 결정한다").

---

## 먼저 할 것 (세션 첫 10분)

1. `git status` — main 작업 트리에 **Phase 7 종료 문서가 미커밋**으로 있다(설계 §9 Phase 7 ⑨·CLAUDE.md·8편 6-7·README·`_next-session-phase7.md` 삭제). `.yarn/install-state.gz`·`PR_DRAFT.md` 는 무관하니 제외.
2. `git checkout -b feat/ops-closing-loop` → 위 문서를 **첫 커밋**(`docs: Phase 7 종료 — 운영 배포 10e9cb4 · 실기기 확인`) — Phase 6 마감 때(`181d182`)와 같은 관례. 이 파일(`_next-session-phase8.md`)도 함께.
3. 읽기: 설계 `docs/roadmap/ops-companion-design.md` §9 **Phase 8** · 학습 노트 `docs/learning/ops-companion/08-guided-review.md` 0-3(재채점 표)·6-5(왜 이름 대조를 놓쳤나)·6-7(Metro reload 함정).

---

## 사용자에 대해

- 신입 프론트엔드 개발자, RN·AI 초행. **이력서 제출이 임박** — 범위를 넓히지 말 것. 설계 결정은 위임돼 있다(메모리 `design_decisions_delegated`): 선택지 나열 대신 **추천 하나와 이유**로 진행하고, 사용자만 할 수 있는 것(토큰 발급·콘솔·머지·실기기 확인·커밋 승인)만 묻는다.
- 포트폴리오 문구 원칙(메모리 `portfolio_scope_principle`): **시연 가능한 것만**. 이번 Phase 결과는 `docs/etc/PROJECT_CARD.md`(gitignore, 로컬 전용)의 "RN 운영 앱 — 차별점 카드"에 반영한다.

---

## A. 코드 이름 대조 칩 (1일 안팎)

### 무엇을

채점 카드(S5)의 분석 아래(또는 확인 항목 ② 옆)에 칩을 붙인다.

```
⚠ 실제 코드에 없는 이름: FRONTEND_URL · callback      (대조한 파일: backend/src/main.ts@00107b7)
```

없으면 "✓ 조치 코드의 이름이 모두 실제 코드에 있습니다", 대조할 코드가 없으면 "대조할 코드 없음"을 그린다. **판정 제안(`suggestVerdict`)은 바꾸지 않는다** — 칩은 사람이 ② 에 답할 근거일 뿐이다.

### 구현 추천(결정 — 바꿔도 되지만 이유를 남길 것)

1. **순수 함수** `extractIdentifiers(fixText)` + `findUnknownIdentifiers(fixText, sourceTexts)` — `backend/src/ops/identifier-check.ts`. 단위 테스트가 대부분의 가치다.
   - 대상: 코드펜스(```…```) 안 + 코드펜스가 없으면 "코드처럼 보이는 줄"(`=`·`(`·`{`·`=>` 포함, 한글 없음). 설명 문장의 영어 단어를 코드로 오인하지 않게.
   - 뽑는 것: 식별자(`[A-Za-z_$][\w$]*`), `process.env.X` 의 `X`, JSX 속성 이름(`<ProductCard data={…}>` 의 `data`).
   - 빼는 것: JS/TS 예약어, 표준 전역·내장 메서드(`Array`·`isArray`·`map`·`filter`·`reduce`·`find`·`push`·`Boolean`·`console`·`JSON`·`Promise`·`Error` …), React/RN 기본(`__DEV__`·`useMemo`·`key` …), 문자열·주석 안의 단어, **조치 코드 안에서 새로 선언한 이름**(`const acc`, `(product) =>` 의 매개변수).
   - 판정: 남은 이름이 대조 코드 텍스트에 **단어 경계로** 없으면 unknown.
2. **대조할 코드** = 메모의 코드 파일(있으면) ∪ `relatedFiles` 정규화 경로의 **파일 전체** — `SourceReaderService` 의 파일 fetch(커밋별 Redis 7일 캐시)를 재사용. ref 는 메모 코드의 ref → 분석의 `tool_calls[0].ref` → `main` 순. ⚠ 블라인드: 두 팔(v1.1·v3.1)이 **같은 파일 집합**으로 대조되게 하라(합집합을 인시던트 단위로 — 팔마다 relatedFiles 가 달라 대조 범위가 달라지면 그게 새 누수가 된다).
3. **어디서 계산**: 대기 응답(`listPending`)에 `identifierCheck: { unknown: string[]; checkedFiles: string[] } | null` 을 싣는다. 50장 × 파일 fetch 는 캐시로 흡수되지만 첫 로드가 느리면 카드 단위 지연 조회로 바꾼다. S4 분석 상세에도 같은 칩을 붙이면 좋다(선택).
4. **DB 변경 없음**을 목표로. 저장이 필요해지면 그때 판단.

### 사전 점검 결과(2026-09-23, 로컬 DB 의 suggestedFix 를 사람이 읽고 예상 — **실측 아님**)

| 분석 | 팔 | 예상 unknown | 메모 |
|---|---|---|---|
| #66 CORS | v1.1 | `FRONTEND_URL`, `callback` | 실제는 `CORS_ORIGINS`·`cb` — Phase 7 에서 사람이 통과시킨 건 |
| #58 a.find | v1.1 | `DEFAULT_IMAGE_URL` | 실제는 `'/images/placeholder.png'` 리터럴 |
| #62 .filter | v1.1 | `currentId` | 실제는 `currentProductId` |
| #56 null.id | v1.1 | `data`(JSX 속성) | 실제 prop 은 `product` — JSX 속성까지 봐야 잡힌다 |
| #67 CORS | v3.1 | `ForbiddenException` | NestJS 클래스라 파일에 없을 뿐 — **거짓 양성 후보**. "파일에 없음(라이브러리 이름일 수 있음)"으로 구분 표시할지 결정 |
| **#54 카테고리** | v1.1 | **없음** | ⚠ `reduce` 로 **다시 쓴** 코드라 이름은 전부 실재. **이 칩으로는 못 잡는다** — 한계로 기록 |
| #55·57·59·60·61·63·64·65 | — | 없음 | 거짓 양성 0 이어야 한다 |

### DoD (A)

1. 14장(#54~#67)의 칩 결과를 표로 — 위 예상과 실측 비교. v1.1 에서 ≥3건 잡히고 v3.1 거짓 양성이 0(또는 #67 처럼 "라이브러리 이름" 구분 1건)
2. 단위 테스트: 추출·제외 규칙(예약어·내장·선언된 이름·문자열·주석·JSX 속성) + 위 14건의 실제 텍스트를 픽스처로
3. 실기기에서 칩이 보인다(로컬 백엔드 — 앱 `.env` 를 LAN IP 로 바꾸고 **Metro `--clear` 후 앱 강제 종료·재실행**, 8편 6-7)
4. 재채점은 **하지 않는다**(시간). 원하면 칩을 보고 #66 한 장만 다시 판정해 "칩이 판정을 바꿨나"를 기록

---

## B. 실제 버그 수정으로 고리 닫기 (반나절 + 선택 반나절)

### B-1. 근거 표 먼저

버그마다 Sentry 이슈 id · 승인된 분석 번호 · 사실 메모를 짝짓는다(메모는 `backend/eval/ops-incident-notes.ts`, 설계 §9 Phase 7 표).

| 이슈 | 파일 | 수정 방향(메모의 정답 조치) |
|---|---|---|
| 7747401267 t is not iterable | `frontend/src/hooks/useCategories.ts` | `flattenTree` 진입 시 `Array.isArray` |
| 7747419604 null.id | `frontend/src/components/home/ProductSection.tsx` | `products.filter(Boolean)` |
| 7747420327 x.map | 같은 파일 33행 | `Array.isArray(result?.data) ? … : []` |
| 7747419820 a.find | `frontend/src/components/home/ProductCard.tsx` 11행 | `Array.isArray(product.images)` |
| 7747424036 .filter | `frontend/src/app/(main)/products/[id]/RelatedProducts.tsx` 26행 | 배열 검증 후 filter |
| (부수 발견) Replay 워커 차단 | `frontend/next.config.js` CSP | `worker-src 'self' blob:` |

⚠ 7744504775(앱 Sentry 테스트)·7732523858(CORS)는 버그가 아니다(메모 참조) — 고치지 않는다. CORS 의 `cb(new Error)` → `cb(null,false)` 는 선택(백엔드 배포가 늘어난다 — 추천: 이번엔 안 함).

### B-2. 프로브 스크립트를 저장소에

Phase 6 의 프로브는 **지난 세션 스크래치에만 있었다**(저장소에 없음). `scripts/probe/` 에 다시 만든다 — 헤드리스 Chrome(Playwright, 7편 6-7 의 버전 함정 참고) + `page.route` 로 **API 응답만** 깨뜨린다(서버 무접촉). 케이스 5개(카테고리 객체 · 상품 목록 null 항목 · 상품 목록 문자열 · images 문자열 · 연관 상품 문자열) · 결과 = 페이지 에러(pageerror)·콘솔 에러 수. Git Bash 는 `/` 로 시작하는 인자를 경로로 바꾼다(7편 6-6).

### B-3. 순서 (전/후가 증거다)

1. **수정 전** 로컬 프론트(`yarn nx dev frontend`)에 프로브 → 5건 모두 깨지는 것을 기록
2. 수정 → 같은 프로브 → 에러 0 · 화면 정상(빈 목록/기본 이미지)
3. `npx tsc`(frontend) · 관련 단위 테스트(있으면)
4. PR 본문에 B-1 표 + 전/후 결과 → 사용자 머지 → Vercel 자동 배포
5. 운영 사이트에 프로브 1회 → Sentry 에 새 이벤트가 **안 생기는지** 확인(수정 전에는 운영 프로브를 돌리지 말 것 — 불필요한 이벤트)
6. ⚠ 이 수정 이후 같은 프로브로는 평가 재료를 더 못 만든다 — 이미 채점 끝, 기록으로 남긴다

### B-4. (선택) 앱에서 해결 처리 — **토큰이 준비됐을 때만**

- 현재 Sentry 토큰은 **읽기 전용**(`event:read`·`org:read`·`project:read`, 2026-09-23 로컬 확인 — 운영 값은 미확인). 이슈 상태를 바꾸려면 `event:write` 가 필요하다 → **사용자가 새 개인 토큰 발급**(기존 3개 + Event Read & Write) → 로컬 `backend/.env` 에 직접 입력 → 운영 EC2 `.env` 는 배포 때 교체(백업 먼저, nginx 런북 방식).
- 백엔드: `POST /v1/ops/incidents/:id/resolve`(admin + **DemoAccountGuard** + `@Auditable`) → Sentry "Update an Issue"(`PUT /api/0/organizations/{org}/issues/{id}/` `{status:'resolved'}` — **구현 시점에 공식 문서로 경로·권한 확인**) → 목록 캐시(`ops:incidents:24h`) 삭제. 토큰에 쓰기 권한이 없으면 Sentry 403 → 우리는 503/502 로 "권한 없음"을 명확히.
- 앱: S3 상세에 "해결됨으로 표시" 버튼(확인 창 1회) → 성공 시 목록 invalidate. 재발하면 기존 폴러가 다시 푸시한다(`is:unresolved` + lastSeen 커서) — 이게 "재발 감시"다.
- 토큰이 없으면 B-4 는 건너뛰고 Sentry 웹에서 수동 Resolve(사용자).

### DoD (B)

1. 수정 전 5건 재현 · 수정 후 0건 — 로컬과 운영(수정 후만) 기록
2. PR 에 근거 표(이슈 → 승인된 분석 → 수정) 
3. Sentry 에서 5건 resolved(앱 버튼 또는 수동) → 앱 목록에서 사라짐
4. (B-4 했다면) 앱 버튼 → Sentry 상태 변경 → 감사 로그 1행

---

## 문서 (Phase 끝)

- 학습 노트 **9편** `docs/learning/ops-companion/09-closing-the-loop.md`(README "이어 쓰는 규칙") — 0-3 에 A 의 14장 표 + B 의 전/후 표
- 설계 §9 Phase 8 진행표·수치 · CLAUDE.md §5 한 줄 · README 목차 · 이 파일 삭제
- `docs/etc/PROJECT_CARD.md` 차별점 카드에 결과 반영(시연 가능한 것만)

## 범위 밖 (하지 말 것)

- LLM judge · Claude 전환 · 범용화(멀티 프로젝트/독립 서비스 — 설계 §9 Phase 8 "확장 메모") · 재채점 · iOS
- #54 같은 "다시 쓴 코드" 탐지(구조 비교) — 한계로 기록만

## 함정 모음

- 로컬 jest: 인라인 config(메모리 `backend_jest_local_run`) — 스크래치에 생성 스크립트를 파일로 쓰고 실행(Git Bash `node -e` 안의 `\\`·따옴표가 깨진다)
- `nx build backend` 는 "pruned lockfile" 경고를 내지만 번들은 나온다 · `nx serve` 는 옛 번들로 뜰 수 있다 → `node --enable-source-maps dist/main.js` 로 직접
- Postgres 별칭은 camelCase 면 **큰따옴표**(8편 6-1)
- Docker 빌드 전 C 드라이브 여유 확인 — 빌드 캐시 `docker builder prune -f --keep-storage 8GB`(7편 부록)
- 개발 빌드 앱: `.env` 변경 → Metro `--clear` → **앱 강제 종료 후 재실행**(reload 하면 `@expo/ui` `UnsatisfiedLinkError`, 8편 6-7)
- 운영 관리자 비밀번호는 Claude 가 모른다 — 운영 데이터 작업은 SQL(SSH) 또는 사용자 로그인
- gh CLI 없음 — PR 은 브라우저, 본문은 Claude 가 초안
