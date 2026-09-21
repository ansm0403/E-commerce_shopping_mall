# 작업: Ops Companion Phase 5 마감 — 배포 · CORS DoD · v3 채점

## 한 문장 목표

**실기기 채점으로 v1·v2·v3 승인율 표(DoD ②)를 만들고, CORS 의 네 번째 시도(서비스 지도)를 사용자와 정한다.**

배포(2026-09-22, main `00107b7` = PR #37)와 DoD ① 확인은 끝났다 — **읽기는 됐고 오답은 그대로**(6편 6-8). 남은 것은 사람이 해야 하는 채점과 방향 결정이다.

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
| 1~5 | PR #37 머지 · 운영 배포(`00107b7`, 마이그레이션 `OpsToolCalls`) · 스모크 · 새 CORS 이벤트(`main.ts:60`, `release 00107b7`) · v3 분석 | ✅ 2026-09-22 | DoD ① 결과: #42(임의 Origin) 정답 · **#43(Origin=서버 자신) 오답 그대로** — 6편 6-8 |
| 6 | **DoD ②** — 실기기 채점 | ✅ 2026-09-22 (v3 8/9, 표는 6편 0-3) | 로컬 DB 의 v3 9건(#29 앱 · #30·31·35·39·40·41 test 세트 · #42·#43 CORS)을 평가 탭에서 채점 → `stats` → v1·v2·v3 표를 6편 0-3·설계 §9 에. 실기기 절차는 5편 7-1(앱 `.env` 를 LAN IP 로, `yarn start --clear`, 끝나면 운영으로 되돌린다). 로컬 백엔드는 `cd backend && OPS_PUSH_ENABLED=false node --enable-source-maps dist/main.js` |
| 7 | 카드 확인 | ✅ CORS 카드(칩 1·"코드 1"). 앱의 "다시 분석" = #44(같은 오답, 미채점) | #29 를 열어 "AI 가 읽은 코드" 칩 2개(`sentry.ts:40-55`·`profile.tsx:30-45`), 메타 "v3 (코드 2)". #43(CORS)은 칩 `main.ts:45-75`. test 6건은 "코드를 읽지 않고 답했습니다" 한 줄 |
| 8 | **CORS 네 번째 시도 (a) 서비스 지도** | ✅ 구현·실측(2026-09-22, 브랜치 `feat/ops-service-map`) | v3.1(#45)·v1.1(#46) 정답. 설계 §9 표 · 6편 "실측 세 번째". **미커밋·미배포** |
| 8-1 | 지도 부작용 측정 | Claude(생성) + 사용자(채점) | test 6건을 `--arms v3.1 --delay 31000` 으로 만들어 채점 → v3 vs v3.1. 6편 0-3 표에 열 추가 |
| 8-2 | 배포 | Claude | 코드 변경(프롬프트·dto·스크립트)이라 이미지 재배포. 마이그레이션 없음, EC2 `.env` 무변경(지도 기본 켬) |
| 9 | 문서 마감 | Claude | 채점 수치를 6편 0-3·설계 §9 에 · README 표 6행 ✅ · 이 파일 삭제 |
| 10 | (선택) 새 preview 빌드 | 사용자 | 운영 백엔드를 상대로 카드를 보려면 `eas build -p android --profile preview` |

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

- main `00107b7`(PR #37) = 운영. 배포 기록·DoD ① 결과 문서는 브랜치 `docs/phase5-deploy` — 사용자 PR 대기
- 로컬 DB: 마이그레이션 적용됨 · 분석 #29(7744504775 v3, 2회 읽음) · #30·31·35·39·40·41(test 세트 v3, 0회) · #42·#43(CORS v3, 1회 읽음 — #43 이 오답) · 채점 0건
- 운영 Sentry CORS 이슈에 이 세션이 만든 이벤트 2건(Origin `phase5-check.invalid` · `api.ansmoon.dev`)이 있다 — 봇 이벤트와 같은 모양
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
