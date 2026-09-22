# 작업: Ops Companion Phase 6 마감 — 커밋 → PR → 백엔드 배포

## 한 문장 목표

**Phase 6 의 코드·문서(채점 수치까지 반영됨)를 커밋해 PR 로 main 에 올리고, 백엔드 이미지를 재배포(마이그레이션 없음)한 뒤 운영에서 프론트 인시던트 1건이 `frontend/src/…` 를 읽는 것을 확인하고 이 파일을 지운다.**

## 먼저 읽어라

1. `docs/learning/ops-companion/07-frontend-sourcemaps-and-eval-set.md` **0-3**(결과·세트·채점 표) · **8장**
2. `docs/roadmap/ops-companion-design.md` §9 **Phase 6** — 진행 표 ⑤(배포)만 ⏳

## 현재 상태 (2026-09-22)

- **채점 완료**: 14장(#54~#67) → `stats --after 54`: v1.1 7/7 · 3.43 · 도구 0 / v3.1 7/7 · 4.29 · 도구 7. 수치는 7편 0-3 · 설계 §9 · README · CLAUDE.md 에 반영됨.
- 브랜치 `docs/phase5-close`(PR #39 열림, 원격 `02710f0`) 위에 **커밋되지 않은 변경**:
  - 백엔드: `source-reader.service.ts`(`PROJECT_ROOTS` · `normalizeFramePath(filename, project?)`) · `.spec.ts`(+12) · `ops-analysis.service.ts`(한 줄) · `ops-review.service.ts`(`getStats(filter)`) · `.spec.ts`(+1) · `dto/incident-detail.dto.ts`(주석) · `eval/ops-review-set.ts`(`list --readable` · `stats --after`) · `eval/results/ops-review-set-2026-09-22T02-04-56-876Z.json`·`…T02-22-45-735Z.json`(생성 기록 — 5편처럼 커밋)
  - 문서: 7편 신규 · 설계 §9 Phase 6 · infra-story · README · CLAUDE.md · 이 파일
  - 루트 `PR_DRAFT.md` 는 옛 셀러 PR 초안(untracked) — 커밋하지 말 것 · `.yarn/install-state.gz` 변경도 커밋 대상 아님
- 검증: ops 단위 159(6 스위트) · `tsc` ops/eval 무오류 · **e2e `mobile-token-and-ops` 22/22**(새 번들의 로컬 4000 대상, 채점 후 실행).
- 로컬 백엔드(4000)는 새 번들로 떠 있다(`OPS_PUSH_ENABLED=false node --enable-source-maps dist/main.js`).
- 앱 `.env` — 채점 때 PC LAN IP 로 바꿨을 수 있다. **운영(`https://api.ansmoon.dev/v1`)으로 되돌렸는지 확인.**
- Vercel: 소스맵 업로드 env 3개 설정됨 — 이후 프론트 배포는 전부 원본 좌표.
- 운영 백엔드는 `7e3784f` — `normalizeFramePath` 변경 전이라 운영의 프론트 인시던트 분석은 "읽을 수 있는 파일 없음".

## 절차

0. 앱 `.env` 는 채점 직후 시점에 **LAN IP(172.30.1.85)** 였다 — 운영 주소로 되돌린다(주석 줄과 맞바꾸기).
1. 커밋 2개 권장: `feat(ops): Phase 6 — 프론트 소스맵 프레임을 저장소 경로로(프로젝트 힌트) + list --readable · stats --after` / `docs: Phase 6 — 7편 · 설계 §9 · infra-story · 채점 수치`. PR #39 에 얹거나(브랜치가 같다) 새 PR.
2. main 머지 → 백엔드 이미지 빌드·EC2 배포(Phase 5 절차 §10-6: `run --rm … migrate.js` 는 "pending 없음" · `up -d` · nginx reload · `/v1/health` version = 새 SHA). **마이그레이션 없음.**
3. 배포 확인: 앱(운영)에서 프론트 인시던트(예: 7747401267) 상세 → "AI에게 원인 물어보기"(force) → 카드에 "AI 가 읽은 코드" 칩 `frontend/src/hooks/useCategories.ts`. 운영 DB 에는 Phase 6 분석이 없다(로컬 DB 에만) — 이 1건이 운영 첫 프론트 읽기다.
4. 설계 §9 Phase 6 진행 ⑤ ✅ + 배포 SHA, 7편 7-2 마지막 체크, README/CLAUDE.md 의 "배포는 PR 뒤" 문구 정리 → 이 파일 삭제.

## 함정

- `stats` 를 `--after` 없이 보면 Phase 5 의 v1.1(#46)·v3.1(#45·#47~#52) 채점이 섞인다.
- 프로브로 새 이벤트를 만들면 그 이슈의 **최신 이벤트**가 바뀐다 — 분석은 최신 이벤트를 본다.
- 로컬 jest 는 Node 22 우회 config(메모리 `backend_jest_local_run`). `nx serve` 는 옛 번들로 뜬다.
- Sentry 이슈 API `statsPeriod` 는 `24h`·`14d`·`30d`.

## 다음 Phase (사용자 승인, 2026-09-22) — Phase 7 채점 안내 + 재채점

전용 인수인계는 **`docs/roadmap/_next-session-phase7.md`**(재채점 경로 부재·블라인드 누수 등 코드에서 확인한 함정 포함). 정의·메모 초안 7건은 설계 §9 **Phase 7**.

## 범위 밖 (기록만 — 다음 방향 후보)

- CSP `worker-src 'self' blob:` — Sentry Replay 압축 워커 차단(7편 6-8). 한 줄이지만 main 푸시 = 프론트 배포.
- `useCategories.flattenTree`·`ProductCard`·`RelatedProducts` 배열/null 가드 — 이번 세트의 인시던트 6건이 근거. 고치면 같은 프로브가 더는 이슈를 못 만든다(측정 재료도 사라진다 — 순서 결정 필요).
- 승인율이 천장이라 다음 측정은 별점 또는 더 고운 척도(예: "조치를 그대로 적용 가능한가")가 필요하다. 자연 발생 인시던트가 쌓이면 재측정.
- LLM Claude 전환 · 보강 후보 2번 나머지("그 커밋의 변경 파일") · 3번(이벤트 여러 건).
