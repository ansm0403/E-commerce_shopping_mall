import type { OPS_VISITOR_TEST_PREFIX as SharedPrefix } from '@shopping-mall/shared';

/**
 * 웹 → 앱 연동 확인용 "방문자 테스트" 이슈 판정 (설계 §9 "웹 → 앱 연동 확인" 결정 ④).
 *
 * 원본은 `@shopping-mall/shared` 의 `OPS_VISITOR_TEST_PREFIX` 다. 그런데 백엔드는 그 패키지를 **값으로 import 하면 안 된다**:
 * Nx webpack 은 buildable 워크스페이스 패키지를 번들에 넣지 않고 `require('@shopping-mall/shared')` 로 남기는데,
 * 운영 이미지는 `yarn workspaces focus --production` 으로 node_modules 를 만들어 그 링크가 없다(2026-09-23 이미지 안에서 확인:
 * `Cannot find module '@shopping-mall/shared'`). 지금까지 백엔드의 shared 사용이 전부 `import type` 이었던 이유다.
 *
 * 그래서 값은 여기 한 번 더 적되, 타입을 shared 의 리터럴 타입으로 묶는다 — 어느 한쪽만 바꾸면 tsc 가 막는다.
 */
export const OPS_VISITOR_TEST_PREFIX: typeof SharedPrefix = '[방문자 테스트';

/**
 * Sentry 이슈 제목은 `VisitorTestError: [방문자 테스트 A7K2] …` 꼴이라 접두어가 맨 앞이 아니다 — includes 로 본다.
 * 목록 API 응답에는 태그가 없어 제목이 유일한 단서다.
 */
export function isVisitorTestTitle(title: string | null | undefined): boolean {
  return typeof title === 'string' && title.includes(OPS_VISITOR_TEST_PREFIX);
}
