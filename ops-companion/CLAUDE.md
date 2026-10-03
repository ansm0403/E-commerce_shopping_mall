# 운영 앱 (`ops-companion/`) — 규칙·함정

> 앱 파일을 읽을 때 자동 로드된다. 실행·배포는 `README.md`, 코드 해설은 `docs/learning/ops-companion/`, 설계·Phase 기록은 `docs/roadmap/ops-companion-design.md` §9.

- Expo SDK 57 + Expo Router. 워크스페이스엔 있지만 **Nx 타깃 아님** — `yarn start`.
- `src/contexts/AuthContext.tsx` 가 프론트에도 같은 이름으로 있다 — 경로를 확인하고 연다.
- 로그인 분기는 `Stack.Protected`(조건부 `<Stack.Screen>` 은 Expo Router 에서 무효). 생체 잠금은 라우트가 아니라 Stack 위 **덮개**(잠긴 동안 뒤에서 딥링크 이동이 끝난다).
- 토큰: SecureStore(`src/lib/token-storage.ts`) + `src/lib/api.ts` 401 갱신(refresh 단일 Promise 공유). 백엔드에 `X-Client: mobile` 헤더(`src/lib/config.ts`).
- 웹 빌드(react-native-web, Vercel 별도 프로젝트): `*.web.ts` 3개 + `Platform.OS === 'web'` 3곳(README "웹 체험판"). 웹은 **데모 로그인만**. API 를 직접 호출하므로 새 도메인은 EC2 `CORS_ORIGINS` 필수(빠지면 500).
- Sentry(`src/lib/sentry.ts`): **`release` 를 적지 않는다**(네이티브 기본값이 소스맵 릴리즈명과 일치해야 한다). 화면 태그는 `useSegments`(`usePathname` 은 카디널리티가 터진다). `beforeSend` 의 쿼터 방어·PII 마스킹은 유지.
- 쿼리: staleTime Infinity 인 `['analysis']` 는 채점 후 무효화해야 S4 가 갱신된다(`src/features/review/queries.ts`).
- 데모 계정 규칙은 앱이 아니라 백엔드(토큰 `isDemo`)가 적용한다 — 앱 화면은 안내일 뿐.
- 배포: preview APK(`eas.json` preview `autoIncrement` — versionCode 가 릴리즈를 가르는 유일한 수단) · JS 만 바뀌면 `eas update --channel preview`(runtimeVersion=appVersion) · 설치 고정 주소는 `vercel.json` `/android` redirect 한 줄만 교체.
