/**
 * Ops Companion Phase 7 — 사실 메모 seed 데이터(설계 §9 Phase 7 표 7건).
 *
 * 프로브를 만든 쪽(6편)이 정확히 아는 정답을 인시던트 단위로 적는다. **초심자가 읽을 수 있게** — 채점자가 RN·AI 초행자인
 * 신입 프론트 개발자다. "이 파일 이 줄에 이 코드가 있다, 그러니 원인은 이것이다" 수준으로.
 *
 * 코드 조각은 여기에 적지 않는다 — `ops-review-set.ts notes seed` 가 `code`(경로·줄·커밋)로 SourceReaderService.read 를 불러
 * 그 커밋의 실제 코드를 읽어 저장한다(사람이 옮겨 적으면 오타가 곧 오판이 된다). 커밋은 이벤트의 릴리즈와 같다:
 * 프론트 프로브 5건 = `7e3784f`(6편에서 읽은 커밋) · 앱 = `main`(앱 릴리즈는 커밋 꼴이 아니다) · CORS = `00107b7`.
 *
 * ⚠ 이 파일은 LLM 입력에 들어가지 않는다. seed 는 ops_incident_notes 에만 쓴다.
 */
import type { UpsertNoteDto } from '../src/ops/dto/note.dto';

export interface IncidentNoteSeed extends UpsertNoteDto {
  incidentId: string;
  /** 사람이 알아보는 이름표(출력용). DB 에 저장하지 않는다 */
  label: string;
}

const FRONT = 'e-commerse-frontend';
const FRONT_REF = '7e3784f';

export const INCIDENT_NOTES: IncidentNoteSeed[] = [
  {
    incidentId: '7747401267',
    label: 't is not iterable (카테고리)',
    project: FRONT,
    symptom:
      '홈 화면이 열리자마자 흰 화면이 됐다. 브라우저가 서버에 카테고리 목록(/api/categories)을 요청했는데, 응답이 배열([...])이 아니라 객체({phase6: …})로 왔다. ' +
      '프론트는 이 응답을 배열이라고 믿고 하나씩 꺼내려다(for…of) "t is not iterable"(순회할 수 없다)로 멈췄다.',
    causeLocation:
      'frontend/src/hooks/useCategories.ts 의 flattenTree 함수(8~16행). 9행 `for (const node of nodes)` 가 객체를 순회하려다 던진다. ' +
      '19행 `data: tree = []` 는 값이 undefined 일 때만 빈 배열로 바꿔 주므로, "배열이 아닌 객체"는 그대로 통과해 flattenTree(25행)에 들어간다.',
    fixDirection:
      'flattenTree 에 들어가기 전에 배열인지 확인한다 — 예: `Array.isArray(tree) ? tree : []` 로 감싸거나 flattenTree 첫 줄에서 `if (!Array.isArray(nodes)) return result;`. ' +
      '또는 useQuery 의 select/서비스 계층에서 응답 모양을 검증한다. 어느 쪽이든 "배열이 아니면 빈 목록"이 방향이다.',
    commonMistakes:
      '(1) flattenTree 를 reduce 로 다시 쓴 "가짜 코드"를 조치로 내놓는다 — 실제 파일에 없는 코드다. ' +
      '(2) "데이터가 아직 안 와서(undefined) 생긴 문제"라고 한다 — 19행의 `= []` 가 undefined 는 이미 막는다. 깨진 것은 배열이 아닌 **객체**다.',
    code: { path: 'frontend/src/hooks/useCategories.ts', startLine: 1, endLine: 28, ref: FRONT_REF },
  },
  {
    incidentId: '7747419604',
    label: "Cannot read properties of null (reading 'id') — 상품 목록",
    project: FRONT,
    symptom:
      '홈의 상품 섹션이 깨졌다. 상품 목록 응답(/api/products?…)의 data 배열 안에 상품 대신 null 이 하나 섞여 왔다. ' +
      '프론트가 그 null 의 id 를 읽으려다(null.id) 멈췄다.',
    causeLocation:
      'frontend/src/components/home/ProductSection.tsx 55~59행 `products.map((product) => <ProductCard key={product.id} …/>)`. ' +
      '33행 `result?.data ?? []` 는 목록 자체가 없을 때만 막고, 목록 **안의** null 항목은 못 막는다. 그래서 57행 `product.id` 에서 던진다.',
    fixDirection:
      'map 전에 null 항목을 걸러낸다 — 예: `products.filter(Boolean).map(…)` 또는 `.filter((p) => p != null)`. 서비스 계층에서 응답을 검증하는 것도 같은 방향이다. ' +
      '`?? []` 를 하나 더 붙이는 것은 답이 아니다(항목 null 을 못 막는다).',
    commonMistakes: '"API 응답이 아직 도착하지 않아서" 류의 설명. 목록은 왔고, 그 안의 한 항목이 null 인 것이 문제다.',
    code: { path: 'frontend/src/components/home/ProductSection.tsx', startLine: 28, endLine: 62, ref: FRONT_REF },
  },
  {
    incidentId: '7747419820',
    label: 'a.find is not a function — 상품 카드 이미지',
    project: FRONT,
    symptom:
      '상품 카드가 그려지다 멈췄다. 상품 하나의 images 필드가 배열이 아니라 문자열로 왔다. ' +
      '문자열에는 find 가 없어서 "a.find is not a function"(축약된 변수 이름 a = images)이 났다.',
    causeLocation:
      'frontend/src/components/home/ProductCard.tsx 의 getProductImageUrl 함수(10~14행). 11행 `product.images ?? []` 는 없을 때만 빈 배열로 바꾸고, ' +
      '12행 `images.find((img) => img.isPrimary)` 가 문자열에 find 를 불러 던진다.',
    fixDirection:
      '11행에서 배열인지 확인한다 — 예: `const images = Array.isArray(product.images) ? product.images : [];`. 그러면 12행·13행이 그대로 안전해진다.',
    code: { path: 'frontend/src/components/home/ProductCard.tsx', startLine: 1, endLine: 27, ref: FRONT_REF },
  },
  {
    incidentId: '7747420327',
    label: 'x.map is not a function — 상품 목록',
    project: FRONT,
    symptom:
      '홈의 상품 섹션이 깨졌다. 상품 목록 응답의 data 가 배열이 아니라 문자열로 왔다. 문자열에는 map 이 없어서 "x.map is not a function"(x = products)이 났다.',
    causeLocation:
      'frontend/src/components/home/ProductSection.tsx 33행 `const products = result?.data ?? [];` 와 55행 `products.map(…)`. ' +
      '`?? []` 는 값이 null/undefined 일 때만 빈 배열로 바꾸므로 문자열은 그대로 통과해 55행에서 던진다.',
    fixDirection:
      '33행에서 배열인지 확인한다 — 예: `const products = Array.isArray(result?.data) ? result.data : [];`. 서비스 계층 검증도 같은 방향.',
    code: { path: 'frontend/src/components/home/ProductSection.tsx', startLine: 28, endLine: 62, ref: FRONT_REF },
  },
  {
    incidentId: '7747424036',
    label: '(intermediate value).filter is not a function — 연관 상품',
    project: FRONT,
    symptom:
      '상품 상세 페이지 아래 "관련 상품" 영역이 깨졌다. 연관 상품 응답의 data.data 가 배열이 아니라 문자열로 왔고, 문자열에는 filter 가 없어서 멈췄다.',
    causeLocation:
      'frontend/src/app/(main)/products/[id]/RelatedProducts.tsx 26행 `const response = data?.data?.data ?? [];` → 28~29행 `response.filter(…)`. ' +
      '`?? []` 는 null/undefined 만 막으므로 문자열이 그대로 29행 filter 에 들어가 던진다.',
    fixDirection:
      '26행에서 배열인지 확인한 뒤 filter 한다 — 예: `const response = Array.isArray(data?.data?.data) ? data.data.data : [];`.',
    code: { path: 'frontend/src/app/(main)/products/[id]/RelatedProducts.tsx', startLine: 12, endLine: 31, ref: FRONT_REF },
  },
  {
    incidentId: '7744504775',
    label: '[ops-companion] Sentry 연결 테스트 (앱)',
    project: 'ops-companion',
    symptom:
      '운영 앱의 프로필 화면에 있는 "Sentry 연결 테스트" 버튼을 누르면 **일부러** 에러 이벤트를 보낸다. 앱은 죽지 않고, 사용자에게는 "전송했습니다" 안내가 뜬다. ' +
      '즉 이 이슈는 버그가 아니라 연결 확인용 이벤트다.',
    causeLocation:
      'ops-companion/app/(tabs)/profile.tsx 의 handleSentryTest(43~52행)가 ops-companion/src/lib/sentry.ts 의 sendSentryTestError 를 부른다. ' +
      'sendSentryTestError 는 `new Error(\'[ops-companion] Sentry 연결 테스트\')` 를 Sentry.captureException 으로 **보내기만** 한다(던지지 않는다).',
    fixDirection:
      '조치 없음이 정답이다. 굳이 하자면 개발 빌드에서만 보이게(`__DEV__` 분기) 하거나 Sentry 에서 이 이슈를 무시 처리한다. severity 는 low 가 맞다.',
    commonMistakes: '"실제 크래시"로 읽어 severity 를 high/critical 로 매기거나, 에러를 try/catch 로 감싸라고 한다 — 감쌀 에러가 없다(던지지 않는다).',
    code: { path: 'ops-companion/app/(tabs)/profile.tsx', startLine: 37, endLine: 52, ref: 'main' },
  },
  {
    incidentId: '7732523858',
    label: 'Not allowed by CORS: https://api.ansmoon.dev (백엔드)',
    project: 'e-commerse-backend',
    symptom:
      '백엔드에 "Not allowed by CORS: https://api.ansmoon.dev" 에러가 반복된다. 봇(자동 스캐너)이 Origin 헤더에 **서버 자신의 도메인**(api.ansmoon.dev)을 넣어 요청했고, ' +
      '백엔드의 CORS 검사가 그것을 허용 목록에 없다고 **정상적으로 막은** 것이다. 진짜 사용자(Vercel 프론트)는 영향이 없다.',
    causeLocation:
      'backend/src/main.ts 55~66행. 55행 `process.env.CORS_ORIGINS` 로 허용 출처 목록을 만들고, 61~66행 `origin: (origin, cb) => …` 콜백이 목록에 없는 Origin 에 65행 `cb(new Error(\'Not allowed by CORS: …\'))` 를 부른다. ' +
      '그 Error 가 Sentry 에 잡힌 것이다. "원인"은 코드 버그가 아니라 봇의 요청 + 정상 차단이다.',
    fixDirection:
      '코드는 제 일을 했다. 조치는 (a) Sentry 에서 이 메시지를 필터/무시하거나 (b) 65행을 `cb(null, false)` 로 바꿔 에러 대신 조용히 거절(500 회피)하는 것. ' +
      '허용 목록에 api.ansmoon.dev 를 **추가하면 안 된다**(서버 자신을 출처로 허용하는 것은 의미가 없고 보안상 나쁘다).',
    commonMistakes:
      '(1) "CORS_ORIGINS 에 https://api.ansmoon.dev 를 추가하라" — 4~6편 내내 나온 오답. ' +
      '(2) `FRONTEND_URL` 배열, `allowedOrigins.push(…)` 같은 실제 파일에 없는 코드를 지어낸다 — 실제 이름은 CORS_ORIGINS·allowedOrigins 뿐이다.',
    code: { path: 'backend/src/main.ts', startLine: 51, endLine: 72, ref: '00107b7' },
  },
];
