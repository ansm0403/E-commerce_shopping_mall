# 작업: Ops Companion Phase 7 — 남은 것 = 커밋 → PR → 운영 배포

> 2026-09-22 갱신. 구현·로컬 검증·실기기 재채점·문서까지 끝났다(브랜치 `feat/ops-guided-review`, **미커밋·미푸시**). 이 파일은 운영 배포 뒤 삭제한다.

## 결과 한 줄

재채점 14장: 승인율 7/7 = 7/7 변화 없음 · 별점 v1.1 3.43 → 3.43, v3.1 4.29 → 4.00 · 항목 ②(지어낸 식별자) ✗ 두 팔 모두 0 — 기대한 #66·#54 가 걸리지 않았다. 옛 CORS v1·v3 는 ③④ ✗ 로 반려. 해석과 다음 단계는 8편 6-5·8장, 설계 §9 Phase 7 진행표 ⑦.

## 지금 상태

- 로컬 DB: 마이그레이션 `OpsGuidedReview1790079789208` 적용 · 메모 7건 · 안내 채점 23행(14 + 옛 9). 운영 DB 는 아무것도 없다.
- 앱 `.env`: 운영(`https://api.ansmoon.dev/v1`)으로 되돌림.
- 로컬 백엔드가 4000 에 떠 있을 수 있다(`netstat -ano | findstr :4000`).
- 검증: ops 단위 172 · e2e 23 · 양쪽 tsc.

## 순서

1. 커밋(사용자 승인 뒤). 변경 파일은 `git status` — 백엔드 ops 모듈 · 마이그레이션 1건 · e2e F 절 · eval 스크립트+메모 데이터 · 앱 3파일 · 문서(설계 §5.1·§9, 8편, README, CLAUDE.md). `PR_DRAFT.md`(옛 파일)와 `.yarn/install-state.gz` 는 제외.
2. 푸시 → PR(gh 없음, 브라우저). 제목 예: `feat(ops): Phase 7 — 채점 안내(사실 메모 + 확인 항목) · 재채점 결과`.
3. 운영 배포(설계 §10-6): 이미지 빌드(`:latest` + `:<sha>`) → push → EC2 pull → **`migrate.js`(마이그레이션 1건)** → up -d → **nginx reload** → `/v1/health` version 단언.
4. 운영 DB 에 메모 7건: EC2 에서 `notes seed` 를 돌리거나(Nest 컨텍스트, GitHub 접근 필요), 로컬에서 운영 API 로 `PUT /v1/ops/incidents/:id/note` 7번(관리자 토큰, body 는 `eval/ops-incident-notes.ts` 그대로 — 코드는 서버가 읽는다). 운영 인시던트 id 는 로컬과 같다(Sentry 가 같다).
5. 앱은 재빌드 없이 Metro 로 확인 가능(카드에 메모·항목이 붙는 것만 바뀌었다). EAS 빌드는 다음 네이티브 변경 때.
6. 이 파일 삭제 · 메모리 `ops_companion_track` 갱신.

## 다음 Phase 후보(8편 8장)

- 항목 ② 를 코드가 미리 표시: 조치 코드에서 식별자를 뽑아 메모 코드 조각/저장소와 대조 → "코드에 없는 이름" 칩. #66(`FRONTEND_URL`·`callback`)·#54(`reduce`)가 이 한 줄로 걸린다.
- 항목 ①④ 는 메모를 정답으로 주는 LLM judge(어시스턴트 Phase 7·A-1 재사용). `checks`·`ops_incident_notes` 가 입력.
