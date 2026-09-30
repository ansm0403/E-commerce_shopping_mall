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

/**
 * Android APK 의 **고정 주소**. 실제 APK(GitHub Release 의 특정 버전)로는 `ops-companion/vercel.json` 의
 * `redirects`(307, 임시 이동)가 보낸다 — 새 빌드를 내도 이 주소와 QR(포트폴리오에 인쇄된 것 포함)은 그대로이고
 * vercel.json 의 destination 한 줄만 바꾼다. 영구 이동(308)은 브라우저가 기억해 옛 APK 로 보낼 수 있어 쓰지 않는다.
 */
export const ANDROID_INSTALL_URL = `${OPS_WEB_URL}/android`;
