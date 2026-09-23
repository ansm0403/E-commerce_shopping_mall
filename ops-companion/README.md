# Ops Companion (RN 운영 앱)

쇼핑몰 백엔드를 재사용하는 관리자용 온콜 앱. 설계는 [docs/roadmap/ops-companion-design.md](../docs/roadmap/ops-companion-design.md) 가 진실의 원천이고, 이 문서는 **실행 방법만** 적는다.

현재 상태: **Phase 0~8 완료**(2026-09-23, 설계 §9). 로그인 · 인시던트 목록/상세 · 푸시/딥링크 · 생체 잠금 · AI 분석(소스 읽기) · 채점(안내·이름 대조 칩)이 운영 백엔드와 붙어 돈다. **외부 방문자는 아래 "설치해서 써 보기"** 로 바로 쓸 수 있다.

## 설치해서 써 보기 (포트폴리오 방문자용)

PC·Metro·Expo 계정 없이, 안드로이드 폰 하나면 된다.

1. 폰에서 설치 링크를 연다 → **https://expo.dev/artifacts/eas/hzxaIa-NMrH-AITYKN2Vz7zJdqMdvuaFEWwjkdTQV1E.apk** (preview 빌드 versionCode 4, 2026-09-23, 약 108MB. 웹 관리자 "운영 앱" 페이지의 QR 도 같은 링크다)
   - **빌드 페이지 링크(`expo.dev/accounts/…/builds/<id>`)가 아니라 APK 직링크다** — 빌드 페이지는 로그인하지 않은 방문자에게 "Something went wrong" 을 보여줬다(2026-09-23 실기기). 직링크는 `eas build:list --json` 의 `artifacts.buildUrl`. **EAS 아티팩트는 빌드 후 14일에 만료**된다(이 빌드는 2026-10-06) — 이력서 기간 동안 살아 있어야 하면 APK 를 GitHub Release 자산으로 올리고 이 링크·웹 페이지 상수·QR 을 그 URL 로 바꾼다.
   - 스토어 밖 APK 라 "출처를 알 수 없는 앱 설치" 를 한 번 허용해야 한다. iOS 는 지원하지 않는다(설계 §9 비목표).
2. 앱을 열고 로그인 화면의 **"데모 계정으로 체험하기"** 를 누른다. 계정 정보는 앱에도 이 문서에도 없다 — 서버가 켜 둔 데모 로그인(`POST /v1/auth/demo-login`, 웹 로그인 화면의 "관리자 페이지 체험하기" 와 같은 경로)이다.
3. 보이는 것은 **실제 운영 Sentry 데이터**다(쇼핑몰 프론트·백엔드의 최근 14일 이슈 — 관리자 계정은 24시간). 이메일·전화는 백엔드가 마스킹하고, 요청 헤더·쿠키·IP 는 애초에 내려오지 않는다(설계 §5.2 · §7).
4. **웹에서 에러를 내고 앱에서 확인하기**(연동이 진짜인지 스스로 확인, 2026-09-23): 쇼핑몰 웹 로그인 화면 → **"관리자 페이지 체험하기"**(앱과 같은 데모 계정) → 관리자 메뉴 **"운영 앱"**(`/admin/ops-app`, 설치 링크·QR 도 여기 있다) → **"테스트 에러 보내기"**. 브라우저가 진짜 에러를 프론트 Sentry 프로젝트로 보내고, 페이지의 추적기가 앱과 같은 `GET /v1/ops/incidents` 를 20초마다 물어 **"앱 목록에 노출 ✓"** 와 첫 발생 시각을 보여준다(보통 1~2분 — Sentry 수집 + 백엔드 캐시 60초). 그 다음 앱(폰에서는 페이지의 "앱에서 열기" 딥링크 `opscompanion://incidents/<id>`)에서 `[방문자 테스트 XXXX]` 를 열어 첫 발생 시각을 비교하고 → AI 분석(이 에러를 만든 `frontend/src/app/(admin)/admin/ops-app/visitor-test.ts` 를 읽는지) → 평가 탭에서 채점 → 분석 화면에서 "내 판정" 을 본다. 이 이슈는 온콜 푸시·Slack 을 울리지 않는다(아래 표).

데모 계정으로 되는 것과 꺼진 것(토큰의 `isDemo` 로 **백엔드가** 판단한다 — 앱 화면은 안내일 뿐):

| 장면 | 데모 계정 | 이유 |
|---|---|---|
| 인시던트 목록·상세 · 릴리즈 건강 | ✅ (목록은 최근 14일) | 조회 전용. 조용한 날 24시간 목록은 비어 있어 체험이 끝나므로 기간을 늘렸다 |
| AI 분석 보기 · **아직 분석이 없는 인시던트 분석하기** | ✅ (새 분석은 **시간당 6건**, 방문자 합산) | 이 앱의 핵심 장면. 상한은 무료티어 LLM 쿼터를 외부인이 태우지 못하게 하는 벽(`OPS_ANALYSIS_DEMO_MAX_PER_HOUR`) |
| "다시 분석"(force) · 강제 실패 | ❌ 403 (버튼도 숨긴다) | 저장된 답을 건너뛰고 LLM 을 다시 부르는 길 |
| 평가 탭 스와이프 채점 | ✅ 저장되지만 **집계·few-shot 예시에서 제외**, 카드는 다음 방문자를 위해 남는다 | 외부인의 판정이 승인율 표와 다음 프롬프트를 오염시키면 안 된다. 방문자 모두가 한 계정이라 "내가 채점한 카드"를 빼면 두 번째 방문자부터 빈 화면 |
| 사실 메모 저장(`PUT …/note`) | ❌ 403 (`DemoAccountGuard`) | 모든 카드에 "정답"으로 붙는 공용 데이터. 앱에 편집 화면도 없다 |
| 푸시 알림 등록 | ❌ 프로필에 "꺼짐 — 데모 계정은 장애 알림을 받지 않습니다" | 외부인의 폰에 운영 장애 푸시가 며칠씩 가면 체험이 아니라 유출. 폴러도 `is_demo` 사용자를 발송에서 뺀다 |
| Sentry 테스트 에러 · 생체 잠금 | ✅ | 앱 자신의 Sentry 프로젝트(DSN 은 공개값, 같은 에러 60초 1건) · 기기 안에서만 처리 |
| **방문자 테스트 이슈**(웹 "운영 앱" 페이지가 만든 `[방문자 테스트 XXXX]`) | ✅ 목록·상세·AI 분석·채점 전부 그대로(관리자 24h 목록에도 보인다) | 방문자가 자기 이슈를 찾아야 한다. 대신 **푸시 폴러가 제목으로 건너뛰고**(`ops-poller.service.ts`) Slack 은 Sentry 알림 규칙의 제목 필터 — 방문자가 누를 때마다 온콜 폰이 울리면 안 된다. 접두어는 `@shopping-mall/shared` `OPS_VISITOR_TEST_PREFIX` 하나. 이슈는 Sentry auto-resolve(14일)로 정리 |

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
데모 관리자 계정(또는 "데모 계정으로 체험하기")도 되지만 위 표의 규칙(재분석·메모·푸시 꺼짐)이 적용된다 — 개발 확인은 실계정으로.

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

## 방문자용 배포 — preview 빌드와 EAS Update

배포 방식은 다섯 가지가 있고, "PC 없이 설치해서 바로 로그인" 이 되는 것은 둘뿐이다.

| 방식 | 설치 | PC/Metro | 푸시 | 방문자에게 |
|---|---|---|---|---|
| Expo Go | 스토어의 범용 앱 | **필요**(QR 로 내 Metro 에 붙는다) | ❌ (SDK 53+) | ✗ — PC 가 켜져 있어야 하고 푸시가 안 된다 |
| 개발 빌드(`development`) | 우리 APK | **필요**(JS 를 Metro 에서 받는다) | ✅ | ✗ — 앱을 켜면 서버 선택 화면에서 멈춘다 |
| **preview 빌드**(`preview`) | 우리 APK, **JS 내장** | 불필요 | ✅ | **✓ 선택** — 링크/QR 로 설치, 켜면 바로 로그인 화면. 소스맵도 이 빌드에서 올라간다 |
| Play 내부 테스트 | Play 콘솔(유료 계정·`.aab`·심사) | 불필요 | ✅ | ✗ — 스토어 배포는 비목표(설계 §9), 테스터 이메일 등록이 필요 |
| EAS Update | (설치가 아니라) 이미 깔린 앱의 **JS 만 교체** | 불필요 | — | ✓ preview 빌드의 **동반자** — 화면 코드만 고쳤을 때 재설치 없이 반영 |

**preview 빌드 만들기**(클라우드, 10~20분). `autoIncrement` 라 versionCode 가 +1 된다(Sentry 릴리즈 이름의 `+N`).

```bash
cd ops-companion
eas build -p android --profile preview          # 끝나면 expo.dev 빌드 페이지에 설치 링크·QR
eas build:list --platform android --limit 3     # 링크를 다시 보려면
```

빌드 페이지 링크(`https://expo.dev/accounts/ansmoon/projects/ops-companion/builds/<id>`)가 곧 설치 링크다. **빌드마다 링크가 바뀌므로** 이 README 의 "설치해서 써 보기" 링크를 같이 고친다.

**EAS Update(2026-09-23 도입)** — `expo-updates` + `app.json` 의 `updates.url`·`runtimeVersion(appVersion)` + `eas.json` 의 프로필별 `channel`. 설정은 `eas update:configure` 한 번이었다.

```bash
cd ops-companion
eas update --channel preview --message "로그인 문구 수정"   # JS 만 바뀐 경우. 설치된 preview 앱이 다음 실행 때 받는다
npx sentry-expo-upload-sourcemaps dist                       # (선택) 업데이트 번들의 소스맵을 Sentry 에
```

규칙: **네이티브가 바뀌면(패키지 추가·`app.json` 플러그인·권한) 빌드**, 화면 코드만 바뀌면 업데이트. `runtimeVersion` 정책이 `appVersion` 이라 네이티브를 바꿀 때는 `app.json` 의 `version` 도 올려야 옛 APK 가 새 JS 를 받지 않는다. 채널이 다르면(`development` 빌드) 업데이트를 받지 않는다.

**데모 로그인을 서버에서 끄려면** 백엔드 `.env` 의 `DEMO_LOGIN_ENABLED=false` — 앱은 버튼을 눌렀을 때 "데모 로그인이 지금은 꺼져 있습니다" 를 보여준다(재빌드 불필요).

## 로컬 백엔드에 붙이려면

`.env` 의 주소를 PC 의 LAN IP 로 바꾼다. 실기기에서 `localhost` 는 **기기 자신**을 가리키므로 쓸 수 없다.

```
EXPO_PUBLIC_API_BASE_URL=http://192.168.0.10:4000/v1
```

안드로이드는 기본적으로 평문 HTTP 를 막는다. Expo Go 개발 중에는 열려 있지만, 실제 빌드에서는 HTTPS(운영 주소)를 쓴다.

⚠ 로컬 DB 의 관리자가 데모 계정(`demo-admin@…`, `is_demo=true`)이면 위 표의 데모 규칙이 그대로 적용된다 — 다시 분석·메모 PUT 이 403, 목록이 14일, 푸시 등록이 꺼진다. 관리자 경로를 확인하려면 비데모 관리자를 하나 만든다(웹에서 가입 → `INSERT INTO user_roles(user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.email='<가입 이메일>' AND r.name='admin'`). 백엔드 e2e 가 만드는 `e2e-mobile-ops-admin@test.local` 도 같은 방식이다.

## 명령

| 명령 | 용도 |
|---|---|
| `yarn start` | 개발 서버(Metro) 실행 |
| `yarn android` | 안드로이드로 바로 열기 |
| `yarn typecheck` | 타입 검사 |
| `npx expo-doctor` | 설정·버전 호환 점검 |
| `eas build -p android --profile development` | 개발 빌드(푸시 확인용 APK) |
| `eas build -p android --profile preview` | **방문자 배포용** APK(JS 내장, 소스맵 업로드, versionCode +1) |
| `eas update --channel preview --message "…"` | 설치된 preview 앱의 JS 만 교체(EAS Update) |
| `npx expo export --platform android` | 기기 없이 번들이 되는지만 확인 |

## 구조

```
app/                     # Expo Router — 파일 경로가 곧 화면 경로
├── _layout.tsx          # Provider + user 유무에 따른 렌더 분기
├── (auth)/login.tsx     # S1 로그인 (+ "데모 계정으로 체험하기" — 방문자 경로)
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
├── features/demo/       # 데모 계정 배너(useIsDemo) — 목록·평가·프로필 화면 위 한 줄. 권한은 백엔드가 정한다
└── features/review/     # 평가 쿼리(낙관적 업데이트) + SwipeCard(gesture-handler·reanimated) + StarRating
```

## 알아둘 것

- **토큰은 SecureStore 에만 저장한다.** AsyncStorage 금지(평문). 설계 §5.6·§7.
- 앱은 모든 요청에 `X-Client: mobile` 헤더를 붙인다. 이 헤더가 있어야 백엔드가 refreshToken 을 응답 body 로 준다(앱에는 쿠키를 구워줄 중간 서버가 없다).
- 서버 데이터는 전부 TanStack Query 를 거친다. 직접 fetch 하지 않는다.
- 이 앱은 백엔드를 반드시 경유한다. Sentry API 토큰을 앱에 넣지 않기 위해서다(설계 §3.1 절대 규칙 2).
