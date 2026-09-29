/**
 * 앱 설정값.
 *
 * `EXPO_PUBLIC_` 접두어가 붙은 환경변수는 빌드 시 **앱 번들에 그대로 박힌다**(웹의
 * NEXT_PUBLIC_ 과 같은 개념). 그래서 여기에는 공개돼도 되는 값만 둔다 —
 * Sentry API 토큰 같은 비밀값은 백엔드 환경변수에만 있고 앱은 백엔드를 경유한다(설계 §7).
 */
import Constants from 'expo-constants';

/**
 * 백엔드 base URL. 운영 EC2 의 nginx 가 TLS 를 종단한다(설계 §3.1-1).
 *
 * 웹 체험판도 같은 주소를 **직접** 부른다. 브라우저라 Origin 이 붙으므로 백엔드 `CORS_ORIGINS` 에
 * 체험판 도메인이 있어야 한다(없으면 백엔드가 500). 쇼핑몰 웹처럼 Vercel 로 중계하지 않는 이유:
 * 이 앱은 쿠키를 쓰지 않고(refresh 는 body), 중계하면 모든 방문자가 Vercel IP 하나로 보여
 * 로그인 레이트리밋을 함께 나눠 쓰게 된다.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.ansmoon.dev/v1';

/** 이 앱 자신의 에러를 보낼 Sentry DSN. 비어 있으면 Sentry 는 자동 비활성(no-op) — 백엔드와 같은 관례. */
export const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

/** 화면에 표시할 앱 버전(ProfileScreen). app.json 의 version 을 읽는다. */
export const APP_VERSION = Constants.expoConfig?.version ?? 'dev';

/**
 * 모바일 클라이언트 표식.
 * 이 헤더가 붙은 요청에만 백엔드가 refreshToken 을 응답 body 에 실어 준다(설계 §5.6).
 * 앱에는 쿠키를 구워줄 BFF 가 없어서 쿠키 기반 refresh 를 쓸 수 없기 때문이다.
 */
export const CLIENT_HEADER = { 'X-Client': 'mobile' } as const;
