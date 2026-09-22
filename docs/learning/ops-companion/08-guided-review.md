# 8편. 채점 안내 — 카드에 정답(사실 메모)과 확인 항목을 붙여 "그럴듯함"이 아니라 "맞음"을 재게 (Phase 7)

> 설계: [ops-companion-design.md §9 Phase 7](../../roadmap/ops-companion-design.md) · 앞 편: [7편](./07-frontend-sourcemaps-and-eval-set.md)
> 작성 시점: main `10e9cb4`(PR #40), 2026-09-22 — 구현·실기기 재채점·운영 배포(마이그레이션 1건 + 운영 DB 메모 7건)까지 완료

## 0-1. 한 문장

**채점 카드에 그 인시던트의 사실 메모(사람이 아는 정답 + 원인 위치의 실제 코드)와 확인 항목 4개를 붙이고, 판정을 안내 전/후로 나눠 저장해 같은 14장을 다시 채점한다.**

## 0-2. 무엇이 문제였나

7편 채점 직후 평가자가 말했다 — "제시된 상황과 해답을 전부 알 수 없어서 임의로 승인한 부분도 많다." 그러니 7편의 승인 14/14 는 "맞다"가 아니라 **"틀렸다고 볼 근거가 없었다"** 이고, 별점 3.43 → 4.29 도 "더 맞다"가 아니라 "더 구체적으로 보인다"일 수 있다. 카드가 판단 근거를 주지 않으면 채점은 자신 있고 구체적인 답에 점수를 준다. 이건 평가자의 문제가 아니라 **카드 설계의 문제**다.

도구가 좋아지면 채점이 덜 필요해지는가? 아니다. 바뀌어야 하는 것은 척도(승인/반려 → 확인 항목)와 재료(카드에 정답이 있는가)다. 5편부터 이어 온 순환 고리의 ③(사람 평가)이 지금까지는 "인상"이었고, 이번 편에서 "대조"가 된다.

## 0-3. 결과

| 무엇이 되는가 | 검증 |
|---|---|
| 인시던트별 **사실 메모** 표(`ops_incident_notes`) + `PUT /v1/ops/incidents/:id/note` — 코드 조각은 사람이 옮겨 적지 않고 서버가 그 커밋에서 읽어 저장 | ✅ 단위 9건(`ops-note.service.spec.ts`) · e2e(PUT 400/CREATED/UPDATED → pending 카드에 `note`) |
| 메모 7건 seed(`eval/ops-incident-notes.ts` + `notes seed`) — 카드에 보인다 — **DoD ①** | ✅ 로컬 DB 7건: `useCategories.ts:1-28@7e3784f` … `main.ts:51-72@00107b7`, 앱은 `profile.tsx:37-52@main`. 실 API 로 #54~#67 전부 `note` 동봉 확인 |
| 평가에 `guided`·`checks` — 안내 전 판정을 **지우지 않고** 안내 판정을 옆 행으로(유니크 키에 guided) | ✅ e2e: 안내 없는 평가 → 안내 평가 = 다른 id, DB 에 두 행 · 안내 평가 재전송은 UPDATED |
| 대기 목록 = "안내 채점이 없는 분석" + 같은 인시던트·같은 버전은 최신 1장 + 재채점은 메모 있는 카드만 + 메모 먼저 + `relatedFiles` 정규화(블라인드 누수 봉합) | ✅ 실 API: 14장의 관련 파일이 두 팔 모두 `frontend/src/…` 꼴(7편에선 v1.1 만 `./src/…`) · 1차 실기기 시도의 50장 반복(6-2)을 규칙 2개로 6장으로(실 API 확인) |
| `stats` 에 안내 전/후 + 항목별 ✓/✗/? | ✅ 단위 · e2e(전/후 분리 집계) · baseline `--after 54`: 안내 전 v1.1 7/7·3.43 / v3.1 7/7·4.29, 안내 후 0 |
| 앱 카드: 메모(접이식, 코드는 기본 접힘) → 분석 → 확인 항목 4개 ✓/✗ → 헤더에 승인/반려 **제안** | ✅ tsc · ⏳ 실기기(재채점 때 첫 카드를 같이 본다) |
| 메모가 LLM 입력에 들어가지 않는다 | ✅ 단위: `OpsAnalysisService` 생성자에 `OpsNoteService` 없음 · few-shot SQL 에 `ops_incident_notes` 없음 · 프롬프트 문자열에 메모 필드 없음 |
| **DoD ② 14장 재채점 → 안내 전/후 표** | ✅ 실기기 14장 + 옛 분석 9장(2026-09-22, 평가자 1명) → `stats --after 54` 아래 표 |
| **DoD ③ 항목 ②(지어낸 식별자) 실패가 어느 팔에서 나오나** | ✅ 수치는 잡혔다 — **두 팔 모두 0건**. 기대했던 #66(`FRONTEND_URL`)·#54(`reduce` 가짜 코드)가 걸리지 않았다(6-5). "걸리지 않으면 그것도 결과다" |

**재채점 결과(2026-09-22, `stats --after 54`, 실기기, 평가자 1명)**

| 팔 | 안내 전 승인율 | 안내 전 별점 | 안내 후 승인율 | 안내 후 별점 | ① 원인 위치 | ② 지어냄 없음 | ③ 그대로 적용 | ④ 확신도 |
|---|---|---|---|---|---|---|---|---|
| v1.1(지도만) | 7/7 | 3.43 | **7/7** | **3.43** | ✓7 ✗0 | ✓7 ✗0 | ✓7 ✗0 | ✓6 ✗1 |
| v3.1(지도+도구) | 7/7 | 4.29 | **7/7** | **4.00** | ✓7 ✗0 | ✓7 ✗0 | ✓7 ✗0 | ✓7 ✗0 |

| 인시던트 | v1.1 별점 전→후 | v3.1 별점 전→후 | 안내 후 쌍별 |
|---|---|---|---|
| 7747401267 t is not iterable | 2 → 2 (#54) | 5 → 5 (#55) | v3.1 +3 |
| 7747419604 null.id | 3 → 4 (#56) | 3 → 4 (#57) | 0 |
| 7747419820 a.find | 4 → 3 (#58) | 5 → 4 (#59) | v3.1 +1 |
| 7747420327 x.map | 4 → 4 (#60) | 5 → 4 (#61) | 0 |
| 7747424036 .filter(연관 상품) | 4 → 3 (#62) | 3 → 3 (#63) | 0 |
| 7744504775 앱 Sentry 테스트 | 3 → 3 (#64, ④ ✗) | 4 → 4 (#65) | v3.1 +1 |
| 7732523858 CORS | 4 → **5** (#66) | 5 → 4 (#67) | **v1.1 +1** |

읽는 법.

- **안내는 판정을 바꾸지 못했다.** 승인 14/14 그대로, 항목은 ④ 한 건(#64, 앱 Sentry 테스트를 확신도 높음으로 말한 것) 빼고 전부 ✓. 별점은 v1.1 이 3.43 → 3.43, v3.1 이 4.29 → 4.00 — 도구 쪽 차이가 0.86 에서 0.57 로 좁혀졌고, 쌍별은 5승 1무 1패 → **3승 3무 1패**.
- **기대한 ② 실패가 나오지 않았다.** #66 의 조치 코드는 `process.env.FRONTEND_URL`·`callback` 을 쓴다(실제 코드는 `CORS_ORIGINS`·`cb`) — 메모의 "흔한 오답 (2)"가 정확히 이것이고, 카드에 그 문장이 있었다. #54 의 원인은 "null 또는 undefined … 비동기 로딩 초기값"(메모의 "흔한 오답 (2)") 이고 조치는 `reduce` 로 다시 쓴 코드(메모의 "흔한 오답 (1)")다. 둘 다 ①②④ 전부 ✓, #66 은 별점이 4 → **5** 로 올랐다. 그런데 옛 분석 쪽에서는 항목이 작동했다 — CORS v1(#7·#14)·v3(#43·#44)은 ③④ ✗ 로 반려됐다(6-5).
- **따라서 이번 편이 잰 것**: 카드에 정답을 써 두는 것만으로는 채점이 대조가 되지 않는다. 안내는 "읽으라"는 요청이고, ② 는 조치 코드의 이름을 코드 조각과 하나씩 대조해야 답할 수 있는 항목이다. 초심자 평가자 1명·카드 23장(1차 17 + 2차 6)의 조건에서 그 대조는 일어나지 않았다. 재료가 아니라 **절차**가 문제다 — 8장.

## 0-4. 무엇이 늘었나

- DB: 표 1(`ops_incident_notes`) · 컬럼 3(`ops_reviews.guided/checks`, `ops_analyses.project`) · 유니크 키 변경 1. 마이그레이션 `OpsGuidedReview1790079789208`.
- 백엔드: `ops-note.service.ts`(+spec) · `dto/note.dto.ts` · `PUT /ops/incidents/:id/note` · `ops-review.service.ts` 세 메서드 변경 · `dto/review.dto.ts`(항목 정의 `REVIEW_CHECKLIST`).
- 앱: `features/review/GuidancePanel.tsx`(신규) · `review.tsx` · `api.ts` 타입.
- 스크립트: `notes seed|list` · `stats` 표 2개. 데이터 `eval/ops-incident-notes.ts`.
- 새 외부 연결 0 · 새 비밀값 0(infra-story 갱신 없음).

## 1장. 이번 편의 용어

### 1-1. ground truth(사실 메모)

평가에서 "정답"으로 삼는 사람의 판단. 어시스턴트 트랙의 골든셋(ex-ai-assistant Phase 7)과 같은 것인데, 거기서는 "이 질문엔 이 도구"였고 여기서는 "이 인시던트는 이 파일 이 줄이 원인이고 조치는 이 방향"이다. 웹에 비유하면 스냅샷 테스트의 기대값 — 사람이 한 번 확인해 고정해 둔 것.

### 1-2. guided / unguided

같은 사람이 같은 분석을 두 번 채점할 수 있다 — 안내 없이(7편까지), 안내와 함께(이번 편). 둘을 **다른 행**으로 두어야 "안내가 판정을 바꿨나"를 잴 수 있다. 그래서 upsert 키가 `(analysis, reviewer)` 에서 `(analysis, reviewer, guided)` 로 늘었다. 웹으로 치면 A/B 테스트의 variant 열이다.

### 1-3. 파생 제안(derived suggestion)

판정을 항목에서 **계산**해 보여주되 강제하지 않는 것. ①②(원인 위치·지어낸 식별자) 중 하나라도 ✗ 면 "반려 제안". 평가자가 반대로 스와이프하면 그게 판정이다. 폼 검증의 "경고"와 "차단"의 차이 — 여기서는 경고다.

### 1-4. 식별자 접기(identifier folding)

Postgres 는 큰따옴표 없는 식별자를 소문자로 바꾼다. `AS chk_causeLocation_pass` 는 결과 열 이름이 `chk_causelocation_pass` 가 된다. JS 에서 camelCase 키로 읽으면 undefined. 이번 편에서 밟은 함정(6-1).

## 2장. 구조

```
backend/src/ops/
├── entity/ops-incident-note.entity.ts   # 신규 — 메모 4필드 + code_* + project + author_id
├── entity/ops-review.entity.ts          # + guided(기본 false) · checks(jsonb) · Unique(analysis, reviewer, guided)
├── entity/ops-analysis.entity.ts        # + project(정규화 힌트)
├── dto/note.dto.ts                      # UpsertNoteDto(code 는 경로·줄·ref 만) · IncidentNoteView · toNoteView
├── dto/review.dto.ts                    # REVIEW_CHECKLIST(문구) · CreateReviewDto(+guided, checks) · ReviewVersionStats(+unguided, guided)
├── ops-note.service.ts                  # 신규 — upsert(코드는 SourceReaderService.read) · findByIncident
├── ops-review.service.ts                # listPending(guided 기준 · note JOIN · blindResult) · submitReview(키에 guided) · getStats(전/후·항목별)
└── ops.controller.ts                    # + PUT incidents/:id/note
backend/eval/
├── ops-incident-notes.ts                # 신규 — 메모 7건(초심자용 문장 + 코드 범위)
└── ops-review-set.ts                    # + notes seed|list · stats 표 2개
ops-companion/
├── app/(tabs)/review.tsx                # 카드 순서 메모→분석→항목 · checks 상태 · guided:true 전송 · 헤더 제안
└── src/features/review/GuidancePanel.tsx# 신규 — GuidancePanel · Checklist · suggestVerdict
```

흐름 한 장: `notes seed`(사람이 쓴 메모 + 서버가 읽은 코드) → `ops_incident_notes` → 앱 `GET pending`(분석 + 메모 + 항목 정의, 버전 없음) → 사람이 ①②③④ 답하고 스와이프 → `POST review {guided:true, checks}` → `ops_reviews` 새 행 → `stats` 가 안내 전/후를 나란히.

## 3장. 코드 읽기

### 3-1. 메모의 코드는 서버가 읽는다 — `ops-note.service.ts`

```ts
if (dto.code) {
  const read = await this.sourceReader.read({ path, startLine, endLine, ref: dto.code.ref ?? this.sourceReader.getDefaultRef() });
  if (!read.ok) throw new BadRequestException(`원인 코드를 읽지 못했습니다: ${read.reason}`);
  code = { path: read.path, ref: read.ref, startLine: read.startLine, endLine: read.endLine, text: read.content };
}
```

왜: 확인 항목 ②("조치 코드의 이름이 실제 코드에 있는가")의 근거가 이 코드다. 사람이 옮겨 적으면 오타가 곧 오판이 된다. 6편의 도구 실행부(`SourceReaderService.read`)를 그대로 쓰므로 허용 폴더·80줄 상한·`scrubText` 가 같다. 읽기에 실패하면 **아무것도 저장하지 않는다** — 코드 없는 메모가 "코드가 있는 척"하지 않게.

또 하나: 이 서비스를 **`OpsAnalysisService` 가 주입받지 않는다**. 메모는 정답이고, 정답이 프롬프트에 들어가면 다음 분석이 오염된다(5편의 few-shot 누수와 같은 종류). 단위 테스트가 `Reflect.getMetadata('design:paramtypes', OpsAnalysisService)` 를 읽어 `OpsNoteService` 가 없음을 고정한다.

### 3-2. 재채점 경로 — `ops-review.entity.ts` · `listPending`

```ts
@Unique(['analysisId', 'reviewerId', 'guided'])
…
AND NOT EXISTS (SELECT 1 FROM ops_reviews r WHERE r.analysis_id = a.id AND r.reviewer_id = $1 AND r.guided = true)
ORDER BY (n.id IS NULL), md5(a.id::text || ':' || $2)
```

왜: 7편까지의 대기 조건은 "이 평가자의 평가가 없는 분석"이라 14장은 앱에 다시 안 나온다. 옛 판정을 지우면 비교의 한쪽이 사라진다. 그래서 유니크 키에 `guided` 를 넣고 대기 조건을 "**안내** 평가가 없는 분석"으로 바꿨다. 부작용: 옛 채점 51건이 전부 다시 대기로 돌아온다 → 메모 있는 카드를 먼저 낸다(같은 인시던트의 두 팔이 같은 메모를 보므로 팔은 안 드러난다). 그래도 25장이다 — 재채점 대상 14장에 같은 인시던트의 옛 분석 11장(CORS 만 10행)이 붙는다.

### 3-3. 블라인드 누수 봉합 — `blindResult`

```ts
const normalized = SourceReaderService.normalizeFramePath(f, project) ?? f.replace(/^\.\//, '');
```

왜: 7편 표 아래에 적어 뒀듯 `relatedFiles` 의 꼴이 팔마다 달랐다 — v1.1 은 프레임 문자열 그대로(`./src/hooks/…`), v3.1 은 읽은 저장소 경로(`frontend/src/hooks/…`). 카드의 "관련 파일" 칩만 봐도 팔을 알 수 있었다. 대기 응답에서만 정규화한다(S4 분석 상세는 블라인드 대상이 아니다). 힌트 `project` 는 새 컬럼 `ops_analyses.project`(분석 시 저장)이고, 옛 행은 `notes seed` 가 메모의 project 로 채우며 SQL 도 `COALESCE(a.project, n.project)` 로 한 번 더 받친다. 실측: #54~#67 전부 같은 꼴이 됐다(0-3).

### 3-4. 항목 정의는 서버에 — `REVIEW_CHECKLIST`

```ts
{ key: 'noInventedIdentifiers', label: '② 조치 코드의 이름(변수·함수·환경변수)이 모두 메모의 실제 코드에 있는가?',
  howTo: '… 코드에 없는 이름이 하나라도 있으면 ✗ (예: CORS 에서 FRONTEND_URL — 실제는 CORS_ORIGINS)' }
```

왜: 문구를 고칠 때 앱을 다시 빌드하지 않기 위해서, 그리고 `checks` 의 키가 무슨 뜻인지가 응답 안에 같이 남도록. 채점자가 초심자라 `howTo` 에 "어느 칸과 대조하나"를 적었다. ①② 만 판정 제안에 쓰고(`REVIEW_VERDICT_RULE_KEYS`) ③④ 는 별점 안내만 — ③④ 는 "맞다/틀리다"보다 "얼마나"에 가깝다.

### 3-5. 앱 카드 순서 — `review.tsx` · `GuidancePanel.tsx`

```tsx
<GuidancePanel note={item.note ?? null} />
<AnalysisCard result={item.result} />
<Checklist items={item.checklist} checks={checks} onChange={onCheck} />
```

왜 메모가 위인가: 채점자는 위에서 아래로 읽는다. 답을 먼저 읽으면 인상으로 판정한 뒤 메모를 확인하게 된다(7편이 잰 것). 정답을 먼저 읽고 → 답을 읽고 → 항목에 답하는 순서가 곧 절차다. 코드는 길어서 기본 접힘 — ② 를 볼 때만 편다. `checks` 는 화면 상태이고 스와이프 때 별점과 함께 비운다(카드마다 새로 시작). 메모가 없는 카드는 "메모 없음"을 그리고, 그 채점은 집계에서 `withNote` 로 따로 센다.

### 3-6. 전/후 집계 — `getStats`

```sql
COUNT(r.id) FILTER (WHERE NOT r.guided AND r.verdict = 'approved')::int AS ug_approved,
COUNT(r.id) FILTER (WHERE r.guided AND (r.checks->>'noInventedIdentifiers')::boolean = false)::int AS "chk_noInventedIdentifiers_fail"
```

왜 같은 열을 세 번 세나: 상단(전체)은 7편까지의 e2e·스크립트가 그대로 읽고, `unguided`/`guided` 가 이번 편의 축이다. 항목은 `checks->>'키'` 를 boolean 으로 읽어 ✓/✗ 를 세고 나머지가 `?`(판단 못 함). 별칭의 큰따옴표는 6-1.

## 4장. 흐름

```mermaid
sequenceDiagram
  participant Script as notes seed
  participant Note as OpsNoteService
  participant Reader as SourceReaderService
  participant DB
  participant App as 앱 S5
  participant Review as OpsReviewService

  Script->>Note: upsert(incidentId, 메모 4필드 + code{path,lines,ref})
  Note->>Reader: read(path, lines, ref)
  Reader-->>Note: {ok, content(줄 번호)} / {ok:false, reason → 400}
  Note->>DB: ops_incident_notes upsert · (seed) ops_analyses.project 채움
  App->>Review: GET analyses/pending
  Review->>DB: ok 분석 LEFT JOIN 메모, NOT EXISTS(guided 평가), 메모 먼저 + md5 셔플
  Review-->>App: [{result(relatedFiles 정규화), note, checklist}] — promptVersion 없음
  App->>App: 메모 읽기 → 답 읽기 → ①②③④ → 제안 → 스와이프
  App->>Review: POST analyses/:id/review {verdict, rating?, guided:true, checks}
  Review->>DB: ops_reviews upsert 키 (analysis, reviewer, guided=true) — 옛 행 보존
  Script->>Review: stats --after 54
  Review-->>Script: 버전별 전체 · unguided · guided(+withNote, 항목별 pass/fail/unknown)
```

## 5장. 앞 편과 달라진 점

| | 7편까지 | 이번 편 |
|---|---|---|
| 카드 | 인시던트 한 줄 + 분석 | + 사실 메모(정답·코드) 위, 확인 항목 아래 |
| 판정 | 스와이프(인상) | 항목 ①② 에서 제안, 스와이프가 덮어씀 |
| 저장 | (analysis, reviewer) 하나 | (analysis, reviewer, guided) — 안내 전/후 두 행 |
| 대기 조건 | 내 평가 없음 | 내 **안내** 평가 없음 · 메모 있는 카드 먼저 |
| relatedFiles | 팔마다 꼴 다름(누수) | 저장소 경로로 정규화 |
| stats | 버전별 | + 안내 전/후 + 항목별 |
| LLM 입력 | 인시던트·지도·도구 | 그대로(메모 금지를 테스트로 고정) |

## 6장. 실제로 밟은 함정

### 6-1. Postgres 가 별칭을 소문자로 접었다

`AS chk_causeLocation_pass` 로 쓴 열이 결과에서 `chk_causelocation_pass` 로 돌아와 camelCase 매핑이 전부 0(unknown). 단위 테스트는 mock 행에 camelCase 키를 넣으니 통과했고, **e2e 가 잡았다**(guided 평가 후 stats 의 `causeLocation.fail` 이 0). 별칭을 `AS "chk_…"` 로 감싸고 단위 스펙에 큰따옴표 여부를 고정했다. "SQL 결과 매핑은 e2e 가 고정한다"는 5편의 분업이 값을 했다.

### 6-2. 옛 채점 51건이 전부 대기로 돌아왔다 — 실기기에서 같은 인시던트가 열 번 나왔다

대기 조건을 guided 기준으로 바꾸자 Phase 4~6 의 채점이 모두 "안내 채점 없음"이 됐다. 메모 있는 카드를 먼저 내도(`ORDER BY (n.id IS NULL), md5(…)`) 앞 25장 중 11장이 같은 인시던트의 옛 분석(CORS 만 10행)이고, 뒤 25장은 메모 없는 옛 카드다. 사용자가 18장쯤에서 "같은 질문이 반복된다, 의미 없다"며 멈췄다 — 맞는 판단이었다. 규칙 둘을 더했다.

- **같은 인시던트·같은 프롬프트 버전은 최신 분석 한 장만**(`a.id = (SELECT MAX(b.id) … WHERE b.incident_id = a.incident_id AND b.prompt_version = a.prompt_version …)`). 재분석(force)으로 대체된 옛 행은 채점 대상이 아니다. prompt_version 은 SQL 안에서만 쓰이고 응답엔 없다.
- **재채점은 메모가 있는 카드만**(`n.id IS NOT NULL OR NOT EXISTS(이 평가자의 판정)`). 메모가 없는데 이미 판정이 있으면 그 판정이 그대로 선다. 아직 판정이 없는 새 분석은 메모와 무관하게 나온다 — 평가 탭의 원래 역할은 그대로다.

결과: 50장 → **6장**(남은 대상 5장 #54·55·57·63·67 + CORS 옛 팔 v3 의 최신 #44 — v1 최신 #14 는 1차에서 이미 채점됨). 멈추기 전 채점한 17장 중 대상 14장에 든 9장은 그대로 유효하고(guided 행), 옛 분석 8장의 채점도 지우지 않는다(stats `--after 54` 가 걸러낸다).

### 6-3. 옛 분석 행에는 project 가 없었다

정규화 힌트 `project` 는 이번 편에 생긴 컬럼이라 #54~#67 은 null 이었다. 메모에 `project` 를 두고 `notes seed` 가 같은 인시던트의 분석 행을 채우게 했고(7건 → 25행), SQL 도 `COALESCE(a.project, n.project)`. 새 분석은 `summarizeIncident` 가 저장한다.

### 6-4. Git Bash 안의 `node -e '…'` 가 `\\` 와 따옴표를 깨뜨렸다

jest 인라인 config 를 한 줄 스크립트로 만들려다 두 번 실패. 스크립트를 파일(`make-jest-config.js`)로 쓰고 실행하니 끝. 7편 6-6("Git Bash 가 `/` 인자를 경로로 바꾼다")과 같은 부류 — 셸을 거치는 문자열은 파일로.

### 6-5. 카드에 정답을 적어 놓아도 대조는 저절로 일어나지 않는다

기대: v1.1 의 #66(`FRONTEND_URL`)·#54(`reduce`)가 ② 에서 ✗. 실제: 둘 다 ①②④ ✓, #66 은 별점 5. 메모의 "흔한 오답" 칸에 그 이름이 그대로 적혀 있었는데도.

이유로 볼 수 있는 것 셋. (1) ② 는 "조치 코드의 이름들을 코드 조각과 하나씩 대조"해야 답이 나오는 항목인데, 카드는 코드 조각을 기본 접어 두었고 대조 절차를 강제하지 않았다 — 접힌 것은 안 읽힌다. (2) 1차 시도에서 반복 카드 17장을 지나온 뒤라 피로가 쌓였다(6-2). (3) 정답 문장이 답 위에 있으면 "답이 정답과 비슷하게 읽히는가"를 보게 된다 — `FRONTEND_URL` 은 문맥상 그럴듯해서 눈에 걸리지 않는다. 대조는 이름 단위의 기계적인 일이고, 사람에게 시키면 빠진다.

반대로 옛 분석 CORS v1(#7·#14)·v3(#43·#44)은 ③④ ✗ 로 반려됐다 — "허용 목록에 추가하라"는 조치는 메모의 "정답 조치의 방향"과 정면으로 어긋나 **문장 수준에서** 보인다. 즉 안내는 방향이 틀린 답은 잡고, 이름이 틀린 답은 못 잡는다. 이 구분이 이번 편의 실제 수확이다.

### 6-6. `-t` 로 테스트를 골라 돌리면 앞 테스트의 부수효과가 사라진다

e2e 실패를 좁히려고 `-t "안내 없는 평가"` 로 돌리자 `withNote` 가 0 — PUT note 테스트가 안 돌아 메모가 없던 것. F 절 전체(`-t "F\."`)로 돌려야 진짜 실패(6-1)만 남았다. 순서에 기대는 e2e 는 describe 단위로 돌린다.

### 6-7. 운영 확인 중 앱이 reload 에서 죽었다 — `UnsatisfiedLinkError`

재채점 뒤 앱 `.env` 를 운영 주소로 되돌렸는데 로그인이 안 됐다. 운영 nginx 로그에 앱 요청이 3시간 동안 **0건** — `EXPO_PUBLIC_*` 값은 번들을 만들 때 박히므로 Metro 가 옛 번들(LAN IP)을 캐시에서 내주고 있었다. `yarn start --clear` 로 다시 띄우자 이번엔 이런 크래시가 났다.

```
java.lang.UnsatisfiedLinkError: No implementation found for void
expo.modules.kotlin.jni.fabric.NativeStatePropsGetter.clearAllContentOriginsImpl()
```

추적: 이 함수를 부르는 곳은 의존성 전체에서 딱 하나, `@expo/ui` 의 `ExpoUIModule` **`OnDestroy`** 다(우리가 설치한 게 아니라 `expo-router` 가 끌고 온 패키지). 즉 React 컨텍스트가 내려갈 때 — **reload 때만** 불린다. Metro 재시작이 개발 빌드를 자동 reload 시켰고, 설치된 APK 의 네이티브 라이브러리에 그 구현이 연결돼 있지 않아 죽었다. 의존성은 Phase 3 이후 그대로라 우리 변경 탓이 아니고, 평소 화면 사용 경로에서는 불리지 않는다.

해결: 앱을 **강제 종료 후 다시 열기**(콜드 스타트는 OnDestroy 를 타지 않는다). 그 뒤 로그인·카드 확인 모두 정상. 교훈 두 가지 — `.env` 를 바꾸면 Metro `--clear` 가 필수이고, 그다음엔 흔들어서 Reload 대신 앱을 껐다 켠다.

## 7장. 실행과 확인

### 7-1. 로컬에서 끝까지

```bash
# 1) 마이그레이션(로컬) — 이미 적용됨
cd backend && NX_DAEMON=false yarn nx run @shopping-mall/backend:migration:run

# 2) 백엔드(새 번들)
NX_DAEMON=false npx nx build backend --skip-nx-cache
cd backend && OPS_PUSH_ENABLED=false node --enable-source-maps dist/main.js

# 3) 메모 seed / 확인
TS_NODE_PROJECT=eval/tsconfig.eval.json node -r ts-node/register/transpile-only eval/ops-review-set.ts notes seed > /tmp/seed.log
TS_NODE_PROJECT=eval/tsconfig.eval.json node -r ts-node/register/transpile-only eval/ops-review-set.ts notes list

# 4) 앱 — .env 를 LAN IP 로(현재 그렇게 돼 있다), 실기기에서 "평가" 탭
cd ops-companion && yarn start --clear

# 5) 집계
TS_NODE_PROJECT=eval/tsconfig.eval.json node -r ts-node/register/transpile-only eval/ops-review-set.ts stats --after 54
```

### 7-2. 확인 체크리스트(Phase 7 DoD)

- [x] `notes list` 에 7건, 각각 코드 범위·커밋이 있다
- [x] `GET pending` 의 #54~#67 에 `note` 가 있고 `relatedFiles` 가 두 팔 모두 저장소 경로다
- [x] 안내 없는 평가 → 안내 평가가 다른 행으로 남는다(e2e)
- [x] 실기기 첫 카드: 메모가 읽히고(사용자가 CORS 메모를 그대로 옮겨 적어 확인), ①② 답하면 제안이 뜬다. 옮겨 적는 수고를 보고 "메모 복사" 버튼을 붙였다
- [x] 14장(+옛 9장) 채점 → `stats --after 54` 안내 후 열이 채워졌다
- [x] 항목 ② 실패가 어느 팔인지 표에 있다 — 두 팔 모두 0(6-5)
- [x] 앱 `.env` 를 운영으로 되돌렸다

### 7-3. 안 될 때

- 카드에 "메모 없음"만 나온다 → `notes list` 가 0건이면 seed 안 됨. GitHub 읽기 실패면 `✗ … 파일이 없다` — 커밋·경로 확인.
- 재채점했는데 stats 안내 후가 0 → 앱이 옛 번들(`guided` 미전송). `yarn start --clear`. DB 에서 `SELECT guided, count(*) FROM ops_reviews GROUP BY 1`.
- 항목별이 전부 `?` → 6-1(별칭 따옴표). 운영 번들이 옛 것인지 `/v1/health` 의 version.

## 8장. 다음

이번 편의 답: 정답을 카드에 적는 것(재료)은 방향이 틀린 답을 잡았고, 이름이 틀린 답은 못 잡았다(6-5). 이름 대조는 사람이 아니라 코드가 할 일이다.

- **항목 ② 를 기계로**: 조치 코드에서 식별자(변수·함수·환경변수·`process.env.X`)를 뽑아 메모의 코드 조각(+ 필요하면 저장소 파일 전체)에 있는지 대조해 카드에 "코드에 없는 이름: `FRONTEND_URL`, `callback`" 을 **미리 표시**한다. 사람은 확인만 한다. #66·#54 가 이 한 줄로 걸린다.
- **항목 ①④ 는 LLM judge 로**: 메모(정답)와 답을 함께 주고 "원인 위치가 같은가 · 흔한 오답을 확신도 높음으로 말했는가"를 채점시킨다 — 어시스턴트 트랙의 골든셋 + judge(ex-ai-assistant Phase 7·A-1) 그대로. 사람은 judge 표본 검증으로 물러난다. 이번 편의 `checks` 4개와 `ops_incident_notes` 가 그 judge 의 입력이다.
- 배포: PR → 운영(마이그레이션 1건 + 운영 DB `notes seed`). 운영 분석은 v3.1 그대로.
