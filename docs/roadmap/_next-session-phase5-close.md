# 작업: Ops Companion Phase 5 마감 — 배포 · CORS DoD · v3 채점

## 한 문장 목표

**`feat/ops-source-reading` 을 운영에 올리고, 새로 들어온 CORS 이벤트를 v3 가 실제로 읽고 오답을 내지 않는지(DoD ①), 실기기 채점으로 v1·v2·v3 승인율 표(DoD ②)를 만든다.**

코드·단위·e2e·로컬 실측·문서는 끝났다(2026-09-22). 남은 것은 **배포와 사람이 해야 하는 확인**뿐이다.

---

## 먼저 읽어라

1. `CLAUDE.md` §5 의 "RN Ops Companion Phase 5 코드·로컬 실측 완료" 줄
2. `docs/roadmap/ops-companion-design.md` §9 **Phase 5** — 결정 6건(⑤는 구현 중 바뀌었다) · 확인한 사실 · 진행 표 ⑦
3. `docs/learning/ops-companion/06-source-reading.md` — **0-3 표의 ⏳ 항목**, **6-4**(test 세트가 왜 도구를 못 썼나), **7-2 체크리스트**
4. `docs/learning/ops-companion/infra-story.md` 3-4(tool use 문단) · 6장(GitHub 행)

---

## 할 일 (순서대로)

| # | 할 일 | 누가 | 비고 |
|---|---|---|---|
| 1 | PR 생성·머지(`feat/ops-source-reading` → `main`) | 사용자 | PR 본문 초안은 이 파일 끝. ⚠ main 푸시 = Vercel 프론트 자동 배포(프론트 변경은 없다) |
| 2 | 운영 배포 — **마이그레이션 1건**(`OpsToolCalls1790026688606`: `ops_analyses.tool_calls` 추가) + **CMD 가 바뀐 이미지**(`--enable-source-maps`, `.map` 8개 포함) | Claude | 절차는 아래. EC2 `.env` 는 안 고쳐도 된다(새 env 전부 기본값). `OPS_ANALYSIS_MAX_PER_MIN` 이 있으면 부팅 로그에 "더 이상 쓰지 않는다" 경고가 뜨는 것이 정상 |
| 3 | 스모크 | Claude | `/v1/health` version == 새 SHA · `/v1/ops/incidents/7732523858` 401(라우트) · `/products` 200. 컨테이너 로그에 `SourceReaderService` 경고가 **없어야** 한다(있으면 `OPS_SOURCE_READ_ENABLED=false`) |
| 4 | **새 CORS 이벤트 확인** | Claude | 봇이 `/blog/wordpress/…` 로 두드릴 때까지 기다린다(하루 수십 건). 관리자 토큰으로 `GET /v1/ops/incidents/7732523858` → `exception.frames[0].filename` 이 `webpack://shopping-mall/backend/src/main.ts` 꼴이고 `release` 가 새 SHA 인지. ⚠ 상세는 Redis 60초 캐시 |
| 5 | **DoD ①** — CORS 를 v3 로 분석 | 사용자(앱 "다시 분석") 또는 Claude(curl `POST …/analysis {"force":true}`) | 응답 `toolCalls` 에 `backend/src/main.ts` 가 있고, `result.suggestedFix` 에 "`api.ansmoon.dev` 를 허용 목록에 추가" 가 **없어야** 한다. 결과를 6편 0-3 표와 설계 §9 ⑦에 기입(맞았든 틀렸든 그대로) |
| 6 | **DoD ②** — 실기기 채점 | 사용자 | 로컬 DB 의 v3 6건(#30·31·35·39·40·41) + #29 를 평가 탭에서 채점 → `stats` → v1·v2·v3 표를 6편 0-3·설계 §9 에. 실기기 절차는 5편 7-1(앱 `.env` 를 LAN IP 로, `yarn start --clear`, 끝나면 운영으로 되돌린다). 로컬 백엔드는 `node --enable-source-maps dist/main.js`(6편 7-1) |
| 7 | 카드 확인 | 사용자 | #29 를 열어 "AI 가 읽은 코드" 칩 2개(`sentry.ts:40-55`·`profile.tsx:30-45`), 메타 "v3 (코드 2)". v3 6건은 "코드를 읽지 않고 답했습니다" 한 줄 |
| 8 | 문서 마감 | Claude | 6편 머리말 커밋 해시 · README 표 6행 ✅ · infra-story 갱신 기록의 브랜치명 → 커밋 · CLAUDE.md 한 줄 · 이 파일 삭제 |
| 9 | (선택) 새 preview 빌드 | 사용자 | 운영 백엔드를 상대로 카드를 보려면 `eas build -p android --profile preview` |

운영 배포 절차(설계 §10-6):

```bash
# [로컬] main 에서
git checkout main && git pull
SHA=$(git rev-parse --short HEAD)
docker build --build-arg GIT_SHA="$SHA" -t ansmoon/shopping-mall-backend:latest -t "ansmoon/shopping-mall-backend:$SHA" -f Dockerfile .
docker push ansmoon/shopping-mall-backend:latest && docker push "ansmoon/shopping-mall-backend:$SHA"
#   ⚠ 빌드가 한 단계에서 오래 멈추면 먼저 `docker images` 가 응답하는지 본다(Docker Desktop 데몬 먹통 — 2026-09-22 실측)

# [EC2] ssh -i ~/.ssh/shoppingApp-key-v2.pem ubuntu@15.164.185.156 ; cd ~/Shopping-mall
docker compose -f docker-compose.prod.yaml pull backend
docker compose -f docker-compose.prod.yaml run --rm backend node backend/dist/migrate.js   # ⚠ exec 아님
docker compose -f docker-compose.prod.yaml up -d
docker compose -f docker-compose.prod.yaml exec -T nginx nginx -t && docker compose -f docker-compose.prod.yaml exec -T nginx nginx -s reload   # ⚠ 빠뜨리면 502
curl -s https://api.ansmoon.dev/v1/health   # version == 새 SHA
docker compose -f docker-compose.prod.yaml logs --tail 50 backend | grep -i "source\|OPS_ANALYSIS"   # 경고 확인
```

⚠ 운영 DB 를 직접 읽는 것은 권한 정책이 막는다. 확인은 API·로그·앱 화면으로.
⚠ 운영 DB 의 평가 행은 0건 — 운영 v3 분석에 few-shot 은 어차피 안 들어간다(v3 는 도구만).

---

## 현재 상태 (2026-09-22)

- 브랜치 `feat/ops-source-reading` (main `ba49f95` 에서). 커밋 여부는 `git log` 로 확인
- 로컬 DB: 마이그레이션 적용됨 · 분석 #29(7744504775 v3, 2회 읽음) · #30·31·35·39·40·41(test 세트 v3, 0회 읽음) · 채점 0건
- 로컬 백엔드: 이 세션이 `backend/` 에서 `node --enable-source-maps dist/main.js`(포트 4000, `OPS_PUSH_ENABLED=false`)로 띄워 뒀을 수 있다 — `netstat -ano | findstr :4000` 으로 확인. `backend/dist` 는 개발 빌드
- 앱 `.env` 는 **운영 주소** 그대로(이 세션은 앱을 띄우지 않았다)
- Gemini flash-lite 무료티어. 이 세션에서 v3 8건 호출

## 알아 둘 것

- **test 세트 6건은 도구를 못 쓴다**(6편 6-4) — 프레임이 전부 번들·청크 좌표. DoD ②의 표는 "도구의 효과"가 아니라 "도구 안내가 있는 프롬프트의 효과"(확신도 하락)를 재는 셈이다. 도구 효과는 배포 후 새 이벤트로만.
- `_next/static/chunks` 프론트 프레임을 살리려면 Vercel 에 `SENTRY_AUTH_TOKEN`·`SENTRY_ORG`·`SENTRY_PROJECT` 를 넣어 소스맵 업로드를 켜야 한다 — 범위 밖, 보강 후보로.
- 로컬 jest 는 인라인 config 우회(메모리 `backend_jest_local_run`). ops 스위트: `testMatch ['**/src/ops/**/*.spec.ts', '**/src/intrastructure/redis/**/*.spec.ts']` 142건.
- Bash 도구 heredoc 안에 `??` 같은 문자가 있는 긴 파이썬은 파싱이 깨진다 — 패치 스크립트는 Write 로 파일에 쓰고 실행.

---

## PR 본문 초안

```
feat(ops): Phase 5 — 소스 코드를 읽는 AI 분석 (read_source tool use)

- read_source 도구: GitHub raw(무인증) + Redis 캐시, 폴더 허용 목록·비밀값 이름 거절, 80줄/회·3회/분석, 실패는 {ok:false, reason}
- 분석 파이프라인: generateWithTools(마지막 라운드만 답) → 교정 재시도는 도구 없이 → ops_analyses.tool_calls 기록, promptVersion v3(도구만, few-shot 없음)
- 상한: 분당 분석 건수 → 분당 LLM 호출 수 예약형(OPS_ANALYSIS_MAX_LLM_PER_MIN 기본 12)
- 백엔드 스택을 원본 좌표로: webpack sourceMaps→sourceMap 오타 수정(운영 빌드에 .map 이 없었다) + CMD node --enable-source-maps
- Sentry release = 배포 커밋(APP_VERSION); 상세 응답에 release·firstRelease
- 앱: 분석 카드 "AI 가 읽은 코드" 섹션, 메타 "(코드 n)"
- 평가 스크립트 --arms v1,v2,v3, stats 에 toolCalled
- 마이그레이션 1건 OpsToolCalls1790026688606 (운영 적용 필요)
- 문서: 학습 노트 6편, infra-story(GitHub), 설계 §9 Phase 5, CLAUDE.md

검증: ops 단위 142(리더 39 · 분석 30) · e2e 22/22 · 백엔드/앱 tsc · 실제 GitHub 스모크 · 로컬 실인시던트 v3(2파일 읽음) · 운영 번들 + --enable-source-maps 로컬 실험

DoD ①(CORS)·②(v1·v2·v3 표)는 배포·채점 후 — docs/roadmap/_next-session-phase5-close.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
