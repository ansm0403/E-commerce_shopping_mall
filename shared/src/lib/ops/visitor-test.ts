/**
 * 웹 → 앱 연동 확인용 "방문자 테스트" 이슈의 제목 규칙
 * (docs/roadmap/ops-companion-design.md §9 "웹 → 앱 연동 확인").
 *
 * 한 문자열을 넷이 나눠 쓴다 — 프론트(에러 메시지 생성), 백엔드(푸시 폴러가 건너뜀),
 * Sentry 알림 규칙(콘솔에 사람이 복사: "title does not contain …"), README.
 * 바꾸면 넷을 같이 바꿔야 하므로 상수는 여기 하나다.
 *
 * 백엔드는 이 파일을 **값으로 import 하지 않는다**: Nx webpack 이 buildable 워크스페이스 패키지를
 * 외부화(`require('@shopping-mall/shared')`)하는데 운영 이미지의 node_modules 에는 그 링크가 없다
 * (`yarn workspaces focus --production`). 백엔드 `ops/visitor-test.ts` 가 `import type` + `typeof` 로
 * 같은 리터럴임을 컴파일 타임에 고정한다.
 *
 * Sentry 이슈 제목은 `ErrorName: message` 꼴이라 접두어가 제목 **맨 앞에 오지 않는다** —
 * 판정은 startsWith 가 아니라 includes 다.
 */
export const OPS_VISITOR_TEST_PREFIX = '[방문자 테스트' as const;

/** Sentry fingerprint 의 고정 앞부분. 뒤에 방문자 코드를 붙여 방문자마다 이슈 하나가 되게 한다 */
export const OPS_VISITOR_TEST_FINGERPRINT = 'portfolio-visitor-test' as const;

/** 앱 목록에 그대로 나타나는 표식 — `[방문자 테스트 A7K2]` */
export function visitorTestMarker(code: string): string {
  return `${OPS_VISITOR_TEST_PREFIX} ${code}]`;
}

/** 에러 메시지 전체 — `[방문자 테스트 A7K2] 웹→앱 연동 확인용 에러` */
export function buildVisitorTestTitle(code: string): string {
  return `${visitorTestMarker(code)} 웹→앱 연동 확인용 에러`;
}

/** 이 제목이 방문자 테스트 이슈인가(푸시·알림에서 건너뛸 대상). 제목이 없으면 false */
export function isVisitorTestTitle(title: string | null | undefined): boolean {
  return typeof title === 'string' && title.includes(OPS_VISITOR_TEST_PREFIX);
}
