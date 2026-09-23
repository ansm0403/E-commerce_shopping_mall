# 작업: 프로젝트 README 전면 갱신 + 포트폴리오 정리 (이력서 제출 전 마지막 정리)

> ⚠ **순서 변경(2026-09-23 저녁)**: 이 작업보다 **`_next-session-web-app-link.md`(웹 → 앱 연동 확인 페이지)를 먼저** 한다. 사용자가 preview APK 를 실기기로 돌려 본 결과 "웹에서 에러를 낼 방법이 없어 연동 여부를 판단할 재료가 없다(mock 처럼 보인다)"는 관찰 → README 의 운영 앱 절에 "웹 관리자 페이지 → 앱 연동 테스트 → 버튼 → 2분 뒤 앱에서 확인" 한 줄이 들어가야 하므로 그 기능이 먼저 있어야 한다. 아래 "앱 배포 링크 자리" 문구에도 이 한 줄을 붙인다.

> 2026-09-23 작성. Ops Companion Phase 8 + 후속(S4 보강)까지 운영 배포·실기기 확인이 끝났다(main `746e946`). 이제 코드가 아니라 **읽히는 문서**를 만든다. 이 세션은 코드를 고치지 않는다(README 의 명령이 실제로 안 돌면 그때만 최소 수정).

## 한 문장 목표

**루트 `README.md` 를 2026-09-23 기준 저장소의 실제 상태로 다시 쓴다** — 2026-06-14 이후 들어온 것(셀러·관리자 코어 완성, DB 마이그레이션, nginx/HTTPS, 관리자 AI 어시스턴트, RN 운영 앱 Ops Companion 9편, 프로브)을 전부 반영하되, **시연 가능한 것만·실측 수치만·과장 없이**. 그리고 로컬 전용 `docs/etc/PROJECT_CARD.md` 를 같은 기준으로 맞춘다.

---

## 먼저 할 것 (세션 첫 15분)

1. `git status` — main `746e946` 에서 시작. 브랜치 `docs/readme-2026-09` 를 만든다. `.yarn/install-state.gz`·`PR_DRAFT.md` 는 커밋하지 않는다.
2. 작은 마감 커밋을 먼저: 9편 `docs/learning/ops-companion/09-closing-the-loop.md` 머리말과 목차(`docs/learning/ops-companion/README.md` 9행)에 후속 PR 해시 `746e946`(PR #42) 한 줄 · 설계 `docs/roadmap/ops-companion-design.md` §9 Phase 8 진행표의 "⏳ 실기기" → ✅(2026-09-23 사용자 확인) · CLAUDE.md §5 Phase 8 줄의 "운영이 GitHub main 보다 앞선다" 문구 삭제 · **Sentry Resolve 진행 상황**: 7747420327(x.map, short id 47ceb6b9)은 사용자가 Resolve 했고 앱 목록에서 새로고침 후 사라짐을 확인(DoD (B)3 동작 확인). 나머지 4건(7747401267·7747419604·7747419820·7747424036)은 세션 시작 시 Sentry API 로 상태를 다시 확인해 적는다(`backend/.env` 의 `SENTRY_AUTH_TOKEN`, `GET https://sentry.io/api/0/issues/<id>/`).
3. 이 파일과 `CLAUDE.md` §1~§5 를 읽고, 그다음 아래 "훑어볼 곳"을 순서대로 읽는다. **README 를 쓰기 전에 실제 파일을 열어 확인한다** — 기억·CLAUDE.md 요약만으로 쓰지 않는다.

---

## 사용자에 대해

- 신입 **프론트엔드** 개발자(백엔드 아님), 풀스택 포트폴리오. **이력서 제출 임박** — 범위를 넓히지 말 것. 설계 결정은 위임돼 있다: 선택지 나열 대신 **추천 하나 + 이유**, 사용자만 할 수 있는 것만 묻는다.
- 포트폴리오 문구 원칙(메모리 `portfolio_scope_principle`): **프론트에서 시연 가능한 범위까지만** 기재. 백엔드 코드가 있어도 화면이 없으면 "있다"고 쓰지 않는다.
- 과장 금지: 표본이 작은 수치(평가자 1명·인시던트 7건)는 "증명"이 아니라 "확인/관찰"로 쓴다. 이 원칙은 PROJECT_CARD 의 "쓸 때 주의" 절에 있다.
- 커밋은 브랜치 → PR → 사용자 머지. `gh` CLI 없음(PR 은 브라우저, 본문은 `PR_DRAFT.md` 초안). main 푸시 = Vercel 재배포.

---

## 현재 README 상태 (2026-09-23 실측)

- 509줄, 마지막 수정 커밋 `6800909`(2026-06-14, 감사 로그 조회). 헤딩: 배포 현황(트래픽 흐름·EC2 선정) · 개발자 · 기술 스택 · 백엔드 스택 선택 이유 · 모노레포 구조 · 주요 기능(인증~관측성) · 프론트엔드 아키텍처 · ERD · API 명세 요약 · 로컬 실행 방법.
- 언급 횟수: `nginx` 3(옛 "nginx 없이 Vercel rewrites 우회" 서술일 가능성 — 확인) · `ops-companion`/운영 앱 **0** · `e2e` **0** · 마이그레이션 1 · Sentry 10 · Vercel 10.
- 즉 **2026-06-14 이후의 변화가 하나도 없다**. 아래 "반영해야 할 변화"가 전부 빠져 있다.

## 반영해야 할 변화 (2026-06-14 이후, 시간순)

| 시기 | 무엇 | 근거 문서 | README 에 들어갈 것 |
|---|---|---|---|
| 2026-07-28 | 셀러·관리자 코어 Step 1~7 완료 — 신청→승인→상품 등록→승인=게시→주문→배송→정산 e2e 시연 가능 | `docs/roadmap/01-seller-core.md`·`02-admin-core.md`, CLAUDE.md §5 | 주요 기능(판매자·관리자) 갱신, 라우트 구조에 `(main)/seller/*`·`(admin)/admin/*` 실구현 목록, e2e 존재 |
| 2026-08-18 | DB 스키마를 **TypeORM 마이그레이션으로만** 변경(synchronize off), EC2 신 스키마+시드 | `docs/roadmap/ex-db-migration.md`(+runbook) | 로컬 실행 방법에 `migration:run` 단계, 백엔드 컨벤션 한 줄 |
| 2026-09-15 | **nginx + HTTPS**(Let's Encrypt) 도입, 신 EC2 `15.164.185.156`, `https://api.ansmoon.dev`, Vercel rewrites 는 그대로 프록시 | `docs/roadmap/03-infra-nginx.md`(v2)·`03-infra-nginx-runbook.md` | **배포 현황·트래픽 흐름 전면 교체**(컨테이너 5개: postgres·redis·backend·nginx·certbot, 포트 80/443 만 공개, 배포 절차 "마지막 nginx reload 필수"). CLAUDE.md §1 의 "nginx 없이" 문구도 함께 고친다 |
| 2026-08~09 | 관측성: Sentry 프론트/백 + Slack 3종, 백엔드 소스맵(`--enable-source-maps`)·`release`, 프론트 Vercel 소스맵 업로드, CSP `worker-src` | `docs/roadmap/ex-sentry-slack.md`·`ex-observability-map.md` | 관측성 절 갱신 |
| 2026-08~09 | **관리자 AI 어시스턴트**: tool use 6종·SSE·멀티턴·PII 마스킹·리뷰 자동 요약·프롬프트 캐싱 측정·골든셋+LLM judge eval 루프(도구 선택 94.1→100%) | `docs/roadmap/ex-ai-assistant.md` | 주요 기능에 새 절(시연 가능: `(admin)/admin/assistant` 화면 있음). 수치는 문서 §8 에서 인용 |
| 2026-09-17~23 | **RN 운영 앱 Ops Companion**(Expo SDK 57, 별도 워크스페이스·Nx 타깃 아님): 로그인·인시던트·푸시/딥링크·생체·AI 분석(소스 읽기 tool use, 서비스 지도)·블라인드 채점·few-shot·사실 메모·이름 대조 칩·프로브로 버그 5건 수정·S4 근거 | `ops-companion/README.md`, `docs/learning/ops-companion/01~09편`, `docs/roadmap/ops-companion-design.md` §9 | **새 대단원**. 모노레포 구조에 `ops-companion/`·`scripts/probe/`, 백엔드 모듈 목록에 `ops`, "실행은 Expo CLI" |
| 2026-09-23 | `scripts/probe/`(헤드리스 Chrome 프로브), `playwright-core` devDependency | `scripts/probe/README.md`, 9편 | 개발 도구 절 또는 Ops Companion 절 안 |

## 훑어볼 곳 (읽는 순서)

1. `CLAUDE.md` §1~§5 — 큰 그림. ⚠ §1 "현재 nginx 없이 Vercel rewrites 프록시로 백엔드 우회" 는 **낡았다**(nginx 도입 후 미갱신) → README 와 함께 고친다. §5 는 사실이지만 서술이 길다 — README 는 요약.
2. `docs/roadmap/README.md` — 로드맵 목차와 상태.
3. `docs/roadmap/03-infra-nginx.md` §1(현재 구조 그림)·§7·§10 — 트래픽 흐름 그림의 원본.
4. `docs/roadmap/ex-observability-map.md` — 관측성 지도.
5. `docs/roadmap/ex-ai-assistant.md` §1(개요)·§8(수치) — 어시스턴트 절 재료.
6. `docs/learning/ops-companion/README.md`(목차, 9편까지) + `ops-companion-design.md` §1(한 문장)·§9 Phase 표 — 운영 앱 절 재료. 수치는 9편 0-3.
7. `docs/etc/PROJECT_CARD.md`(gitignore, 로컬) — 이력서 문구·차별점 카드·"쓸 때 주의". README 와 **같은 사실·같은 수치**를 쓰는지 대조.
8. 실제 코드로 확인할 것: `backend/src/app/app.module.ts`(모듈 목록), `frontend/src/app/` 폴더(라우트 실구현 vs stub — `(admin)/admin/categories` 와 `(main)/seller/{dashboard,inquiries}` 는 stub), `docker-compose.prod.yaml`(컨테이너 5개), `nginx/`(설정), `package.json` 워크스페이스, `backend-e2e/src/backend/*.e2e.spec.ts`(e2e 목록), `.github/workflows/`(CI 가 무엇을 돌리나).
9. 기존 README 의 "로컬 실행 방법"·env 목록은 **실제 `.env.example` 들과 대조**(backend/frontend/ops-companion). 빠진 env(`OPS_*`, `SENTRY_*`, `GEMINI_*`, `LLM_PROVIDER`, `CORS_ORIGINS`, `TRUST_PROXY_HOPS`) 반영.

## README 구조 제안 (추천 — 바꿔도 되지만 이유를 남길 것)

1. **한 단락 소개 + 배포 링크 + 사실 배지**(프론트 Vercel URL, API `https://api.ansmoon.dev/v1/health`, 운영 앱은 스토어 미배포·EAS 내부 배포)
2. **아키텍처 그림 1장**(Mermaid): 브라우저 → Vercel(rewrites `/api`) → nginx(443) → NestJS → Postgres/Redis · RN 앱 → nginx 직접 · Sentry/Slack · GitHub raw(소스 읽기) · Gemini. 기존 "트래픽 흐름" 절을 이것으로 교체
3. **기술 스택**(표 1개 — 지금처럼 이유 절을 길게 두지 말고 각 줄에 "왜" 한 구절)
4. **주요 기능** — 구매자 / 판매자 / 관리자(대시보드·승인·주문·정산·감사 로그·**AI 어시스턴트**) / 관측성. 각 항목은 "화면 경로 + 백엔드 엔드포인트 + 있으면 e2e 파일" 한 줄. stub 은 stub 이라고 쓴다
5. **Ops Companion(RN 운영 앱)** — 별도 대단원. 무엇인지 한 문장 → 순환 고리 그림(Sentry → 앱 → AI 분석 → 사람 채점 → 프롬프트/도구 개선 → 실제 수정) → **실측 표**(6~9편 수치: 소스 읽기·서비스 지도로 CORS 오답 해소, 14장 블라인드 채점, 이름 대조 칩 4/7 vs 0/7, 프로브 5/5→0/5) → 학습 노트 9편 링크. **주의 문구**(표본 7건·평가자 1명, 메모 초안은 AI) 반드시
6. **인프라·배포** — nginx/HTTPS 구성, 배포 절차 요약(이미지 2태그 → EC2 pull → migrate → up → nginx reload → health 버전 단언), 마이그레이션 원칙, CI 가 도는 것
7. **로컬 실행** — 실제 명령만(`docker compose -f docker-compose.local.yaml up -d` → `yarn` → 마이그레이션 → `yarn nx serve backend`/`yarn nx dev frontend` → 앱은 `cd ops-companion && yarn start`). **직접 실행해 보고 적는다**
8. **문서 지도** — `docs/roadmap/*`·`docs/learning/ops-companion/*`·`scripts/probe/README.md` 링크 표. ERD·API 명세는 기존 것을 유지하되 새 엔드포인트(`/v1/ops/*`, `/v1/admin/assistant`, `/v1/products/:id/review-summary`, `/v1/health` readiness)를 추가

길이 목표: 지금(509줄)보다 **짧거나 비슷하게**. 새 내용이 많으니 옛 서술(스택 선택 이유 장문, EC2 선정 과정)을 줄여서 자리를 만든다. 옛 서술은 삭제가 아니라 `docs/` 로 옮기고 링크.

## 앱 배포 링크 자리 (2026-09-23 외부 배포 세션에서 추가 — README 갱신 때 채울 것)

- 별도 세션(브랜치 `feat/ops-public-demo`)에서 **외부 방문자용 preview APK + 데모 계정 경로**를 만들었다. 루트 README 의 Ops Companion 절에 넣을 문구:
  - "**설치해서 써 보기**: 안드로이드 설치 링크 `https://expo.dev/artifacts/eas/hzxaIa-NMrH-AITYKN2Vz7zJdqMdvuaFEWwjkdTQV1E.apk`(preview versionCode 4, 2026-09-23 — `ops-companion/README.md` "설치해서 써 보기" 절과 같은 값. **빌드 페이지가 아니라 APK 직링크** — 페이지는 익명 방문자에게 오류. 아티팩트는 2026-10-06 만료 → GitHub Release 자산으로 옮길 것) → 로그인 화면 **데모 계정으로 체험하기**(계정 정보 없음, 서버가 켜고 끈다). 실제 운영 Sentry 데이터(최근 14일). 조회·AI 분석·채점 가능, 재분석·메모·푸시는 데모 계정에서 꺼짐."
  - 근거 문서: `ops-companion/README.md`(설치·표·배포 방식 비교) · `docs/learning/ops-companion/appendix-public-demo.md`(왜 그렇게 정했나) · 설계 §9 "외부 배포".
  - **"웹에서 에러 내기" 한 줄(2026-09-23 구현, `feat/ops-web-app-link`)**: "웹 로그인 → **관리자 페이지 체험하기** → 관리자 메뉴 **운영 앱**(`/admin/ops-app`) → **테스트 에러 보내기** → 페이지가 앱과 같은 API 로 '앱 목록에 노출 ✓' 를 보여주면 앱에서 `[방문자 테스트 XXXX]` 를 열어 분석·채점해 보세요." — 근거 `ops-companion/README.md` "설치해서 써 보기" 4번 · 부록 §7.
- 빌드마다 링크가 바뀐다 — README 에는 링크를 직접 적지 말고 `ops-companion/README.md` 절로 링크하는 편이 안전하다.

## 원칙

- **시연 가능한 것만** — 화면이 없는 백엔드 기능은 "API 만" 이라고 명시. stub 라우트는 stub.
- **수치는 출처와 함께** — 각 수치 옆에 (9편 0-3), (ex-ai-assistant §8-15) 처럼 문서 절을 적는다. 문서에 없는 수치는 쓰지 않는다.
- **과장 금지** — "증명했다" ✗ → "확인했다/관찰했다". 표본 크기를 같은 문장에.
- **링크는 전부 실제 파일**을 가리키는지 확인(경로에 괄호는 `%28%29`).
- **명령은 실제로 돌려 본 것만**. 이 세션에서 로컬 인프라(postgres/redis 컨테이너)를 띄우고 README 의 로컬 실행 절을 위에서부터 그대로 따라가 본다. 안 되면 README 를 고친다(코드가 아니라).
- CLAUDE.md 는 "지속 컨텍스트"라 README 와 역할이 다르다 — README 를 CLAUDE.md 로 만들지 말고, CLAUDE.md 의 낡은 문구(§1 nginx)만 고친다.

## PROJECT_CARD(로컬, gitignore) 정리

- "Phase 8 은 운영 배포 전" 주의 문구 삭제 → "운영 배포 완료(main `d370e03`·`746e946`), 실기기 확인 완료(2026-09-23)".
- "차별점 카드" 표에 S4 보강 한 줄(근거를 채점 화면에서 고치는 화면으로) + Sentry Resolve 로 고리가 닫힌 사실(재발 감시는 폴러).
- README 와 수치·문구가 어긋나지 않게 마지막에 한 번 대조.

## DoD

1. README 의 모든 링크가 실제 파일/URL 을 가리킨다(스크립트로 확인).
2. "로컬 실행" 절을 그대로 따라 백엔드 `/v1/health` 200 · 프론트 홈 200 이 뜬다(직접 실행).
3. 새 대단원 Ops Companion 에 실측 표 + 주의 문구가 있다. 수치마다 출처 절.
4. CLAUDE.md §1 의 낡은 nginx 문구가 고쳐졌다.
5. PR 1개(`docs/readme-2026-09`), 본문은 "무엇을 빼고 무엇을 넣었나" 표.

## 범위 밖 (하지 말 것)

- 코드 수정(README 명령이 실제로 안 도는 경우의 최소 수정만) · 새 기능 · 디자인 시스템 · 영어 README(요청 있으면 별도) · 블로그 글(`docs/blog` 는 손대지 않음)

## 함정 모음

- 병렬 Bash 호출은 cwd 를 공유한다 — 절대경로로. 메모리/문서 갱신은 백틱 때문에 `node -e "…"` 금지, 셸 heredoc 도 긴 한글 본문에서 깨진 적이 있다 → **긴 문서는 Write 도구로** 쓴다.
- 로컬 Node 22 에서 `nx test backend` 는 jest.config 파싱 실패(메모리 `backend_jest_local_run`) — README 의 테스트 명령은 CI(Node 24) 기준으로 쓰고 로컬 우회법은 각주.
- `nx lint` 는 로컬 20분+ — 돌리지 않는다.
- 로컬 디스크 여유 약 2GB(Docker VHDX 46GB). 이 세션은 이미지 빌드가 없어야 한다.
- `docs/etc/` 는 gitignore — PROJECT_CARD 는 커밋되지 않는다(로컬에만).
