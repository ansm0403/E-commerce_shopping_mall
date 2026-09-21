# Ops Companion (RN 운영 앱)

쇼핑몰 백엔드를 재사용하는 관리자용 온콜 앱. 설계는 [docs/roadmap/ops-companion-design.md](../docs/roadmap/ops-companion-design.md) 가 진실의 원천이고, 이 문서는 **실행 방법만** 적는다.

현재 상태: **Phase 1 진행 중** — 로그인, 인시던트 목록, **인시던트 상세**, 프로필은 Expo Go 로 확인했다. 푸시·딥링크는 **개발 빌드**가 있어야 확인할 수 있다(아래). AI 분석·평가는 Phase 3 이후.

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

## 푸시 알림 (Phase 1)

⚠ **Expo Go 로는 원격 푸시를 받을 수 없다.** SDK 53 부터 안드로이드 Expo Go 에서 `expo-notifications` 의
원격 푸시가 빠졌다(공식 문서: *"A development build is required to use push notifications"*).
알림 권한 요청과 채널 생성까지는 Expo Go 에서도 동작하고, 프로필 탭의 "푸시 알림" 칸이 그 이유를 알려준다.

### 개발 빌드 = 내 앱 전용 설치 파일

Expo Go 대신 이 프로젝트만 담은 APK 를 한 번 만들어 설치한다. 그 뒤로는 지금처럼 `yarn start` + QR 로
JS 만 갈아 끼우면 되고, 네이티브 패키지를 새로 추가할 때만 다시 빌드한다.

**처음 한 번(계정·자격증명)**

1. [expo.dev](https://expo.dev) 가입 → `eas login`
2. `eas init` — 이미 완료(`extra.eas.projectId` 가 app.json 에 있다)
3. [Firebase 콘솔](https://console.firebase.google.com)에서 프로젝트 생성 → **Android 앱 추가**
   - 패키지 이름은 반드시 **`dev.ansmoon.opscompanion`** (app.json 의 `android.package`)
   - `google-services.json` 을 내려받아 `ops-companion/` 에 두고 app.json 에 아래를 추가한다.
     이 파일은 공개 식별자뿐이라 커밋해도 된다.
     ```json
     "android": { "googleServicesFile": "./google-services.json" }
     ```
4. Firebase **프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성** → 받은 JSON 을 expo.dev 의
   **Project settings → Credentials → FCM V1 service account key** 에 업로드
   (⚠ 이 JSON 은 비밀값이다. `.gitignore` 가 `*-firebase-adminsdk-*.json` 을 막아 둔다)

**빌드와 설치**

```bash
cd ops-companion
eas build --platform android --profile development   # 10~20분, 끝나면 QR 로 APK 설치
yarn start                                           # 설치된 앱으로 QR 을 찍는다
```

**확인**

프로필 탭의 "푸시 알림" 이 `켜짐` 이면 기기 토큰이 백엔드에 등록된 것이다. 백엔드는 2분마다 Sentry 를
확인해 **error·fatal** 인 새 이슈(또는 6시간 쿨다운이 지난 재발)를 이 기기로 보낸다.
알림을 탭하면 해당 인시던트 상세로 들어간다 — 앱이 꺼져 있었어도 마찬가지다.

## Sentry 연결 확인

개발 모드(`yarn start`)에서는 Sentry 가 꺼져 있다(쿼터 보호). 확인할 때만 배포판처럼 띄운다.

```bash
# .env 에 EXPO_PUBLIC_SENTRY_DSN 을 넣은 뒤
yarn start --no-dev --minify --clear
```

프로필 탭에서 "Sentry: 켜짐" 을 확인하고 **Sentry 테스트 에러 보내기** 를 누른다. Sentry 의 `ops-companion` 프로젝트 Issues 에 "Sentry 연결 테스트" 가 뜨면 된다.

## 소스맵 업로드 (Phase 2)

**소스맵** = 압축된 번들의 좌표(`index.android.bundle:1:55048`)를 원본 파일·줄(`app/(tabs)/profile.tsx:41`)로
되돌리는 대응표다. 빌드할 때 Sentry 에 올려 두면, 나중에 도착한 에러의 스택이 원본으로 복원돼 보인다.

업로드는 **EAS 빌드 안에서 자동으로** 일어난다. 세 조각이 맞물린다.

| 조각 | 위치 | 하는 일 |
|---|---|---|
| org·project | `app.json` 의 `@sentry/react-native` 플러그인 옵션 | prebuild 때 `android/sentry.properties` 로 기록된다 |
| Debug ID | `metro.config.js` 의 `getSentryExpoConfig` | 번들과 소스맵에 같은 고유 표식을 심는다(짝짓기 열쇠) |
| 업로드 | SDK 의 `sentry.gradle` | **debug 가 아닌 변형**(preview·production)의 번들 작업 끝에 `sentry-cli` 로 올린다 |

→ **development 빌드는 올리지 않는다**(debug 변형이고, JS 를 PC 의 Metro 에서 받는다). 복원 확인은 preview 빌드로 한다.

**처음 한 번 — 업로드용 토큰**

1. Sentry → **Settings → Developer Settings → Organization Tokens** → *Create New Token*.
   이것은 **Organization Token**(`sntrys_` 로 시작)으로 권한이 CI 용으로 고정돼 있다 — 릴리즈·소스맵 업로드는 되고
   이슈 조회는 안 된다. 백엔드가 쓰는 **개인 토큰**(`sntryu_`, 권한을 직접 고른 것)과 **다른 토큰**이다.
   ⚠ 생성 직후 한 번만 보여준다. 창을 닫기 전에 2번을 끝내라.
2. EAS 에 비밀값으로 등록한다(값은 명령행에 적지 말고 프롬프트에 붙여 넣는다 — 셸 기록에 남는다).
   ```bash
   cd ops-companion
   eas env:set --name SENTRY_AUTH_TOKEN --visibility secret --environment preview --environment production
   ```

⚠ 이 토큰은 **EAS 빌드 서버에서만** 쓰이고 앱 바이너리에 들어가지 않는다(`EXPO_PUBLIC_` 접두어가 없는 값은
번들에 박히지 않는다). `app.json` 의 플러그인 옵션 `authToken` 에는 **절대 적지 않는다** — 저장소에 남는다.

**DSN 은 `eas.json` 에 있다.** `.easignore` 가 `.env` 를 올리지 않으므로, EAS 빌드는 로컬 `.env` 의 DSN 을
보지 못한다. DSN 은 공개돼도 되는 값이라(설계 §3.1 규칙 3) preview·production 프로필의 `env` 에 직접 적었다.

**확인**

```bash
eas build --platform android --profile preview
```

빌드 로그에서 `Sentry-CLI arguments:` 와 `Uploaded files to Sentry` 를 찾는다. 설치 후 프로필 탭의
**Sentry 테스트 에러 보내기** → Sentry 이슈의 스택이 `app/(tabs)/profile.tsx` 로 보이면 된다.

## AI 분석 (Phase 3)

인시던트 상세 맨 아래 **"AI에게 원인 물어보기"** → 백엔드가 LLM(현재 Gemini)에 스택트레이스·직전 행동을 넘겨
원인·조치를 JSON 으로 받아 카드로 그린다. 앱은 LLM 을 직접 부르지 않는다 — API 키는 백엔드에만 있다.

- 백엔드 `.env` 에 `GEMINI_API_KEY` 가 없으면 화면은 "AI 분석 미설정"(503) 이다. 나머지 기능은 그대로 돈다.
- 첫 요청은 5~15초 걸린다. 같은 인시던트를 다시 열면 저장된 결과를 바로 준다. **"다시 분석"** 을 눌러야 새로 부른다.
- 무료티어 상한(분당 5건) 을 넘으면 "요청이 잠시 몰렸습니다"(429). 1분 뒤 다시.
- 섹션마다 **복사** 버튼, 맨 위에 **전체 복사**가 있다. 다른 AI 에게 "이 분석이 맞나?" 라고 되물을 때 붙여 넣는다.
- **구조화 실패 화면 확인** — 개발 빌드에서만 보이는 `[DEV] 구조화 실패 시뮬레이션` 버튼을 누른다. 백엔드가 LLM 없이
  실패 행을 만들어 준다(**로컬 백엔드에서만** 동작한다. 운영 백엔드는 이 옵션을 무시하고 실제 분석을 한 번 더 한다).

## 평가 (Phase 4)

하단 **평가** 탭 — AI 분석을 카드 한 장씩 보고 **오른쪽으로 밀면 승인, 왼쪽은 반려**(아래 버튼도 같다). 별점 1~5 는 선택.
스와이프 순간 다음 카드가 뜨고 저장은 뒤에서 나간다. 실패하면 카드가 되돌아오고 알림이 뜬다.

- 카드에는 **프롬프트 버전이 없다**(블라인드). 백엔드가 응답에서 뺀다 — 채점이 끝난 뒤 `GET /v1/ops/analyses/stats` 에서만 v1·v2 가 갈린다.
- 승인한 분석은 다음 AI 분석의 **예시(few-shot)** 로 프롬프트에 들어간다 → 그 분석의 메타 줄이 `프롬프트 v2 (예시 3)` 으로 바뀐다.
- 분석 화면(S4) 맨 아래 **"이 분석 평가하기"** 를 누르면 그 카드가 평가 탭 맨 앞에 온다. 이미 채점한 분석이면 알려만 준다.
- 평가 세트를 한꺼번에 만들거나 승인율을 보려면 `backend/eval/ops-review-set.ts`(`list` / `seed` / `test` / `stats`).
- 스와이프가 **아예 안 움직이면** 루트 `_layout.tsx` 의 `GestureHandlerRootView` 가 빠진 것이다(에러 없이 조용히 죽는다).

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
| `eas build -p android --profile development` | 개발 빌드(푸시 확인용 APK) |
| `npx expo export --platform android` | 기기 없이 번들이 되는지만 확인 |

## 구조

```
app/                     # Expo Router — 파일 경로가 곧 화면 경로
├── _layout.tsx          # Provider + user 유무에 따른 렌더 분기
├── (auth)/login.tsx     # S1 로그인
└── (tabs)/
    ├── incidents/_layout.tsx # 목록 → 상세 스택(anchor=index)
    ├── incidents/index.tsx   # S2 인시던트 목록
    ├── incidents/[id].tsx    # S3 인시던트 상세 (푸시 딥링크 도착지) + "AI에게 원인 물어보기"
    ├── incidents/analysis/[id].tsx  # S4 AI 분석 (구조화 카드 / 실패 fallback) + "이 분석 평가하기"
    ├── review.tsx            # S5 평가 카드 스택 (스와이프 승인/반려 + 별점)
    └── profile.tsx           # S6 프로필
src/
├── lib/api.ts           # axios 인스턴스 + 401 시 refresh 1회 재시도
├── lib/notifications.ts # 알림 채널·권한·토큰 등록
├── features/push/       # 등록 상태 Context + 딥링크 3상태 라우팅
├── lib/token-storage.ts # SecureStore 토큰 저장소
├── lib/sentry.ts        # Sentry init (DSN 없으면 no-op)
├── lib/config.ts        # 환경변수 읽기
├── contexts/AuthContext.tsx
├── features/incidents/queries.ts
├── features/analysis/   # 분석 쿼리(useAnalysis·useReanalyze) + 카드·fallback 컴포넌트
└── features/review/     # 평가 쿼리(낙관적 업데이트) + SwipeCard(gesture-handler·reanimated) + StarRating
```

## 알아둘 것

- **토큰은 SecureStore 에만 저장한다.** AsyncStorage 금지(평문). 설계 §5.6·§7.
- 앱은 모든 요청에 `X-Client: mobile` 헤더를 붙인다. 이 헤더가 있어야 백엔드가 refreshToken 을 응답 body 로 준다(앱에는 쿠키를 구워줄 중간 서버가 없다).
- 서버 데이터는 전부 TanStack Query 를 거친다. 직접 fetch 하지 않는다.
- 이 앱은 백엔드를 반드시 경유한다. Sentry API 토큰을 앱에 넣지 않기 위해서다(설계 §3.1 절대 규칙 2).
