# Ops Companion (RN 운영 앱)

쇼핑몰 백엔드를 재사용하는 관리자용 온콜 앱. 설계는 [docs/roadmap/ops-companion-design.md](../docs/roadmap/ops-companion-design.md) 가 진실의 원천이고, 이 문서는 **실행 방법만** 적는다.

현재 상태: **Phase 0 완료(2026-09-20, 실기기 DoD 통과)** — 로그인, 인시던트 목록, 프로필. 푸시·딥링크·AI 분석·평가는 Phase 1 이후.

## 처음 한 번

```bash
cd ops-companion
cp .env.example .env     # 기본값은 운영 백엔드(https://api.ansmoon.dev/v1)
```

의존성은 저장소 루트에서 관리한다(Yarn workspaces). 루트에서 `yarn install` 을 이미 했다면 따로 설치할 것이 없다.

## 실기기에서 실행 (Expo Go)

```bash
cd ops-companion
yarn start          # = expo start. 터미널에 QR 코드가 뜬다
```

1. 안드로이드 기기에 **Expo Go** 앱을 설치한다(Play 스토어).
2. Expo Go 로 QR 을 찍는다. PC 와 기기가 **같은 Wi-Fi** 에 있어야 한다.
3. 안 붙으면 `yarn start --tunnel` 로 터널 모드를 쓴다(회사·공유기 격리 환경에서 필요).

로그인은 **관리자 권한 계정**으로 한다. 인시던트 목록이 관리자 전용이기 때문이다.
데모 관리자 계정도 조회는 되지만, 쓰기 동작이 막혀 있어 Phase 1 이후에는 실계정을 쓰는 편이 낫다.

> ⚠ 로그인은 IP 당 10회 / 5분 제한이 있다. 비밀번호를 반복해서 틀리면 5분간 잠긴다.

> ⚠ 코드를 바꿨는데 화면이 그대로면, Expo Go 가 백그라운드의 옛 화면을 되살린 것이다. 최근 앱 목록에서 앱 카드와 Expo Go 카드를 둘 다 닫고 QR 을 다시 찍는다.

## Sentry 연결 확인

개발 모드(`yarn start`)에서는 Sentry 가 꺼져 있다(쿼터 보호). 확인할 때만 배포판처럼 띄운다.

```bash
# .env 에 EXPO_PUBLIC_SENTRY_DSN 을 넣은 뒤
yarn start --no-dev --minify --clear
```

프로필 탭에서 "Sentry: 켜짐" 을 확인하고 **Sentry 테스트 에러 보내기** 를 누른다. Sentry 의 `ops-companion` 프로젝트 Issues 에 "Sentry 연결 테스트" 가 뜨면 된다.

## 로컬 백엔드에 붙이려면

`.env` 의 주소를 PC 의 LAN IP 로 바꾼다. 실기기에서 `localhost` 는 **기기 자신**을 가리키므로 쓸 수 없다.

```
EXPO_PUBLIC_API_BASE_URL=http://192.168.0.10:4000/v1
```

안드로이드는 기본적으로 평문 HTTP 를 막는다. Expo Go 개발 중에는 열려 있지만, 실제 빌드에서는 HTTPS(운영 주소)를 쓴다.

## 명령

| 명령 | 용도 |
|---|---|
| `yarn start` | 개발 서버(Metro) 실행 |
| `yarn android` | 안드로이드로 바로 열기 |
| `yarn typecheck` | 타입 검사 |
| `npx expo-doctor` | 설정·버전 호환 점검 |
| `npx expo export --platform android` | 기기 없이 번들이 되는지만 확인 |

## 구조

```
app/                     # Expo Router — 파일 경로가 곧 화면 경로
├── _layout.tsx          # Provider + user 유무에 따른 렌더 분기
├── (auth)/login.tsx     # S1 로그인
└── (tabs)/
    ├── incidents/index.tsx   # S2 인시던트 목록
    └── profile.tsx           # S6 프로필
src/
├── lib/api.ts           # axios 인스턴스 + 401 시 refresh 1회 재시도
├── lib/token-storage.ts # SecureStore 토큰 저장소
├── lib/sentry.ts        # Sentry init (DSN 없으면 no-op)
├── lib/config.ts        # 환경변수 읽기
├── contexts/AuthContext.tsx
└── features/incidents/queries.ts
```

## 알아둘 것

- **토큰은 SecureStore 에만 저장한다.** AsyncStorage 금지(평문). 설계 §5.6·§7.
- 앱은 모든 요청에 `X-Client: mobile` 헤더를 붙인다. 이 헤더가 있어야 백엔드가 refreshToken 을 응답 body 로 준다(앱에는 쿠키를 구워줄 중간 서버가 없다).
- 서버 데이터는 전부 TanStack Query 를 거친다. 직접 fetch 하지 않는다.
- 이 앱은 백엔드를 반드시 경유한다. Sentry API 토큰을 앱에 넣지 않기 위해서다(설계 §3.1 절대 규칙 2).
