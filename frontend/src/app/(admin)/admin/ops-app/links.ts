/**
 * 운영 앱으로 들어가는 두 입구. 서버 컴포넌트(page.tsx)와 클라이언트 컴포넌트(LinkCheckSection)가 함께 쓰므로
 * 'use client' 파일 밖에 둔다 — 'use client' 모듈의 export 는 서버에서 값이 아니라 클라이언트 참조로 넘어온다.
 */

/** Expo 앱 scheme(app.json `scheme: opscompanion`) + 푸시가 쓰는 경로 `/incidents/<id>` 와 동일 */
export const appDeepLink = (incidentId: string) => `opscompanion://incidents/${incidentId}`;

/**
 * 같은 앱을 웹으로 내보낸 체험판(react-native-web, Vercel 별도 프로젝트 — `ops-companion/vercel.json`).
 * 아이폰(APK 설치 불가)·PC 방문자의 입구. 로그인 전에 열어도 데모 로그인 뒤 이 경로로 돌아온다(앱의 usePushRouting.web.ts).
 */
export const OPS_WEB_URL = 'https://e-commerce-ops-companion.vercel.app';
export const webTrialLink = (incidentId: string) => `${OPS_WEB_URL}/incidents/${incidentId}`;
