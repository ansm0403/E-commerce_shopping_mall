# 작업: Ops Companion Phase 7 — 채점 안내(사실 메모 + 확인 항목) + 재채점

## 한 문장 목표

**채점 카드에 인시던트별 사실 메모와 확인 항목 4개를 붙여, 채점이 "그럴듯한 답"이 아니라 "맞는 답"에 점수를 주게 하고, Phase 6 의 14장(#54~#67)을 안내와 함께 다시 채점해 안내 전/후를 비교한다.**

출발점은 Phase 6 채점 직후 사용자의 진술이다 — "제시된 상황과 해답을 전부 알 수 없어서 임의로 승인한 부분도 많다." 그래서 Phase 6 의 승인 14/14 는 "맞다"가 아니라 "틀렸다고 볼 근거가 없었다"이다. 카드가 판단 근거를 주지 않은 **설계 문제**이지 평가자의 문제가 아니다. 사용자는 "답변마다 채점 방법을 제공하자"는 제안을 수락했다(2026-09-22).

---

## 먼저 읽어라 (이 순서로)

1. `docs/roadmap/ops-companion-design.md` §9 **Phase 7** — 배경 · 정의 · 구현 초안 · DoD · **사실 메모 초안 7건(표)**
2. `docs/learning/ops-companion/07-frontend-sourcemaps-and-eval-set.md` **0-3**(채점 결과 표 · "타당성 한계" 문단) · **8장**
3. `docs/learning/ops-companion/05-review-loop.md` **3-2**(대기 목록 — 블라인드·해시 셔플) · **3-3**(upsert) · **3-6·3-7**(앱 스와이프 카드·낙관적 업데이트)
4. `docs/roadmap/ex-ai-assistant.md` Phase 7·A-1 — 골든셋 + LLM judge(이번 범위 밖이지만 Phase 7 의 다음 단계)

코드 출발점:

| 파일 | 무엇 |
|---|---|
| `backend/src/ops/ops-review.service.ts` | `listPending`(44~80행 부근, `NOT EXISTS` 로 채점한 행을 뺀다) · `submitReview`(upsert) · `getStats({minAnalysisId})` |
| `backend/src/ops/dto/review.dto.ts` | `CreateReviewDto`(verdict·rating·comment) · `PendingReviewItem`(promptVersion 을 **일부러 뺀다**) |
| `backend/src/ops/entity/ops-review.entity.ts` · `ops-analysis.entity.ts` | 컬럼 추가 대상 |
| `backend/src/ops/ops.controller.ts` | `GET analyses/pending`(86행) · `POST analyses/:id/review`(108행) |
| `backend/src/database/migrations/` | 마지막 = `1790026688606-OpsToolCalls.ts`. 새 파일은 `index.ts` 에 **명시적 등록**(글롭은 조용히 실패 — CLAUDE.md §3) |
| `backend/eval/ops-review-set.ts` | `stats --after` — guided 전/후 열을 여기에 |
| `ops-companion/app/(tabs)/review.tsx` · `src/features/review/{SwipeCard,StarRating,queries}.tsx` | 카드에 "채점 안내" 섹션 + 체크 4개 |

---

## 현재 상태 (2026-09-22)

- **Phase 6 는 채점까지 끝났고 커밋은 안 됐다.** 브랜치 `docs/phase5-close`(PR #39 열림, 원격 `02710f0`) 위에 백엔드 7파일 · 문서 5파일 · 신규 4파일이 미커밋이다. 목록과 권장 커밋 분할은 `docs/roadmap/_next-session-phase6-close.md` "현재 상태"·"절차". **Phase 7 착수 전에 Phase 6 을 먼저 커밋할지 사용자에게 확인하라** — 같은 브랜치에 섞이면 PR 이 두 Phase 를 담는다.
- Phase 6 채점 수치(`stats --after 54`): v1.1 7/7 · 별점 3.43 · 도구 0 / v3.1 7/7 · 4.29 · 도구 7. 쌍별 v3.1 5승 1무 1패.
- 로컬 DB: 분석 #14~#67. Phase 6 세트 = #54~#67(인시던트 7건 × v1.1·v3.1). 평가자 1명(로컬 demo admin 계정).
- 로컬 백엔드(4000)는 Phase 6 번들로 떠 있을 수 있다(`netstat -ano | findstr :4000`).
- 앱 `.env` 는 채점 때 **LAN IP(`172.30.1.85`)** 로 바꿔 둔 상태일 수 있다. 재채점도 로컬이 필요하므로 그대로 두되, 끝나면 운영으로 되돌린다.
- 운영 백엔드는 `7e3784f`(Phase 6 변경 미배포).

---

## 사용자에 대해

- RN·AI 초행자이고 신입 프론트엔드 개발자다. Phase 6 착수 결정 5건을 "이해하기 어렵다, 네 판단을 믿겠다"며 위임했다(메모리 `design_decisions_delegated`). **선택지를 나열하지 말고 추천 하나와 이유로 진행하라.** 사용자만 정할 수 있는 것(비용·범위·콘솔 설정·커밋 시점)만 묻는다.
- 채점자가 바로 이 사용자다. 메모는 **도메인 지식 없이 읽혀야** 한다 — "이 파일 이 줄에 이 코드가 있다, 그러니 원인은 이것이다" 수준으로.

---

## 설계에서 반드시 지킬 것 (코드에서 확인한 함정)

1. **재채점 경로가 없다.** `listPending` 은 `NOT EXISTS (… r.reviewer_id = $1)` 로 이미 채점한 분석을 뺀다. 14장은 그대로는 앱에 다시 안 나온다. 추천: `ops_reviews.guided`(boolean, 기본 false) 를 두고, 대기 목록을 "이 평가자의 **guided 평가**가 없는 분석"으로 바꾼다. 옛 평가(guided=false)는 지우지 않는다 — 안내 전 데이터가 비교의 한쪽이다. upsert 키 `UNIQUE(analysis_id, reviewer_id)` 는 그대로면 guided 평가가 옛 평가를 **덮어쓴다** → 키를 `(analysis_id, reviewer_id, guided)` 로 바꾸거나, 옛 판정을 별도 컬럼(`unguided_verdict`·`unguided_rating`)으로 옮긴 뒤 덮어쓴다. 어느 쪽이든 마이그레이션에서 기존 행을 guided=false 로 보존하는 것을 테스트로 고정하라.
2. **블라인드가 이미 새고 있다.** `result_json.relatedFiles` 꼴이 팔마다 다르다 — v3.1 은 `frontend/src/hooks/…`(읽은 저장소 경로), v1.1 은 `src/hooks/…`·`./src/app/…`(프레임 문자열 그대로). 카드에 관련 파일이 보이면 채점자가 팔을 짐작할 수 있다. 대기 응답에서 relatedFiles 를 **정규화**(`normalizeFramePath(p, project) ?? p`)해 두 팔을 같은 꼴로 만들어라. 앱의 분석 상세(S4)는 정규화하지 않아도 된다(블라인드 대상이 아니다).
3. **확인 항목 ②("조치 코드가 실제 파일의 식별자만 쓰는가")의 근거를 `toolCalls` 칩으로 주면 안 된다.** 칩은 v3.1 에만 있으므로 그 자체가 팔을 드러낸다(Phase 5 부터 대기 응답에서 뺀 이유). 대신 **사실 메모에 원인 위치의 실제 코드 몇 줄을 넣어** 두 팔에 똑같이 보여준다. 메모의 코드는 사람이 쓰거나, 메모 seed 스크립트가 `SourceReaderService.read` 로 그 커밋(`7e3784f` · 앱은 `main` · CORS 는 `00107b7`)에서 가져와 저장한다(추천: 스크립트가 가져오고 사람이 범위만 정한다 — 오타 없음).
4. **메모는 인시던트 단위다**(분석 단위 아님). 같은 인시던트의 두 팔이 같은 메모를 본다. 메모가 없는 인시던트(자연 발생·미조사)는 카드에 "메모 없음"을 표시하고, 그 평가는 stats 에서 따로 센다.
5. **메모는 LLM 입력에 절대 들어가지 않는다.** 정답이 프롬프트로 새면 다음 분석이 오염된다(5편 누수). few-shot 선정(`selectFewShot`)·`buildUserPrompt` 어디서도 `ops_incident_notes` 를 읽지 않게 하고, 단위 테스트로 고정하라.
6. 승인/반려는 체크에서 **파생 제안**하되 평가자가 덮어쓸 수 있게. 추천 규칙: ① 원인 위치 ✗ 또는 ② 지어낸 식별자 ✗ → 반려 제안, 나머지는 승인 제안. ③④ 는 별점에 반영하라고 안내만.

---

## 확인 항목 4개 (카드 문구 초안 — 초심자가 읽을 수 있게)

| # | 카드 문구 | 확인 방법(카드에 같이) |
|---|---|---|
| ① | 원인으로 짚은 파일·함수가 메모의 "원인 위치"와 같은가? | 메모의 파일 이름·함수 이름을 답의 "원인"에서 찾는다 |
| ② | 조치 코드에 **메모의 코드에 없는** 변수·함수·환경변수가 나오는가? (나오면 ✗) | 조치 코드의 이름들을 메모의 실제 코드와 대조한다. 예: CORS 에서 `FRONTEND_URL` 은 실제 코드에 없다(실제는 `CORS_ORIGINS`) |
| ③ | 조치를 그대로 붙여 넣어도 되는가? (다른 곳을 깨거나 원인과 무관하면 ✗) | 메모의 "정답 조치의 방향"과 같은 방향인가 |
| ④ | 확신도가 근거에 비해 과하지 않은가? | 메모에 "흔한 오답"이 있는데 그 오답을 high 로 말하면 ✗ |

---

## 진행 순서 (작게, 확인 수단 먼저)

① **Phase 6 커밋 여부를 사용자에게 확인** → ② 마이그레이션 1건(`ops_incident_notes` + `ops_reviews.guided`·`checks jsonb` + 기존 행 보존) → 로컬 `migration:run` → ③ 메모 seed 스크립트(`ops-review-set.ts notes seed` 또는 별도 파일 — 설계 §9 Phase 7 표 7건 + 원인 위치 코드 자동 추출) → ④ 백엔드: `listPending` 을 guided 기준으로 · 응답에 `note`·relatedFiles 정규화 · `CreateReviewDto` 에 `checks`·`guided` · `getStats` 에 guided 전/후 → 단위(메모가 LLM 입력에 안 들어감 · 기존 평가 보존 · 블라인드 유지) + e2e(pending 키 목록이 바뀌므로 `mobile-token-and-ops` F 절 갱신) → ⑤ 앱: 카드 "채점 안내" 접이식 섹션 + 체크 4개 → 판정 제안 · tsc → ⑥ **사용자가 14장 재채점**(실기기, 로컬 백엔드) → ⑦ `stats --after 54` 로 guided 전/후 · 항목 ② 실패가 v1.1 에만 나오는지 → ⑧ 문서(8편 `08-<영문-케밥>.md` · 설계 §9 Phase 7 진행·수치 · README · CLAUDE.md · infra-story 는 변화 없으면 갱신 기록만) → 이 파일 삭제.

⚠ ⑥ 전에 앱에서 카드 한 장을 사용자와 함께 보고 문구가 읽히는지 확인하라 — 이번 Phase 의 목적 자체가 "채점자가 이해할 수 있는가"다.

---

## DoD

1. 7건의 메모가 들어가 카드에 보인다(원인 위치의 실제 코드 포함)
2. 14장을 안내와 함께 재채점 → `stats --after 54` 가 **guided 전/후**를 나란히 낸다(승인율·별점·항목별 통과율)
3. 항목 ②(지어낸 식별자) 실패가 어느 팔에서 나오는지가 수치로 잡힌다 — 6편 이후 도구의 몫("지어내지 않음")을 처음으로 채점으로 확인

기대(단정 아님): 안내 후 v1.1 의 CORS(#66, `FRONTEND_URL` 지어냄)와 카테고리(#54, `reduce` 로 다시 쓴 가짜 코드)가 ② 에서 걸린다. 걸리지 않으면 그것도 결과다.

---

## 알아 둘 것 / 함정

- 로컬 jest 는 Node 22 에서 `jest.config.ts` 파싱 실패 → 인라인 JSON config(메모리 `backend_jest_local_run`). ops 스위트 현재 159건.
- `nx serve backend` 는 옛 번들로 먼저 뜬다 → `NX_DAEMON=false npx nx build backend --skip-nx-cache` 후 `cd backend && OPS_PUSH_ENABLED=false node --enable-source-maps dist/main.js`.
- e2e 는 떠 있는 4000 을 대상으로 돈다. 돌리면 분석 id 가 3개씩 뛴다(버그 아님). pending 응답 키가 바뀌면 F 절의 키 목록 단언을 고친다.
- 마이그레이션 CLI 는 cwd=backend, DataSource 는 `src/database/data-source.ts`. 생성: `nx run @shopping-mall/backend:migration:generate --name=<이름>`.
- 평가 탭은 pending 만, 인시던트 목록은 24h 만 보인다 — 옛 인시던트의 분석은 평가 탭으로만 들어간다.
- 프로브로 새 이벤트를 만들지 말 것 — 이슈의 최신 이벤트가 바뀌면 메모와 어긋난다.
- Bash heredoc 안의 긴 파이썬 패치는 깨진다 — 스크립트는 Write 로 파일에 쓴 뒤 실행. Git Bash 는 `/` 로 시작하는 인자를 경로로 바꾼다.
- gh CLI 없음(GitHub 은 curl). Vercel 은 Claude 가 볼 수 없다.

## 범위 밖

- LLM judge 자동 채점(메모·항목이 쌓인 다음 단계)
- 자연 발생 인시던트의 메모 작성(조사 필요 — 이번엔 7건만)
- Phase 6 부수 발견(CSP `worker-src` · `flattenTree`·`ProductCard` 가드) — 고치면 같은 프로브가 더는 이슈를 못 만들어 측정 재료가 사라진다. Phase 7 재채점이 끝난 뒤에
- LLM Claude 전환 · 보강 후보 2번 나머지 · 3번

## Phase 가 끝나면

1. 학습 노트 **8편** `docs/learning/ops-companion/08-<영문-케밥>.md`(README "이어 쓰는 규칙")
2. 설계 §9 Phase 7 진행·수치(guided 전/후 표)
3. CLAUDE.md §5 한 줄 · README 목차 · 이 파일 삭제
