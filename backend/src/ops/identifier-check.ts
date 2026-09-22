/**
 * 조치 코드 이름 대조(설계 §9 Phase 8 A) — 순수 함수. I/O 없음.
 *
 * 무엇을 하나: AI 의 추천 조치(suggestedFix)에서 **코드로 보이는 부분**의 이름(변수·함수·속성·환경변수·JSX 속성)을 뽑아,
 * 실제 소스 파일의 이름 집합과 대조한다. 소스 어디에도 없는 이름이 "지어낸 이름" 후보다. 확인 항목 ②("조치 코드의 이름이
 * 모두 실제 코드에 있는가")를 사람이 답할 때의 **근거**이고, 판정은 아니다 — 카드의 승인/반려 제안(suggestVerdict)은 건드리지 않는다.
 *
 * 왜 기계가 하나: Phase 7 재채점에서 사람은 방향이 틀린 답(CORS "허용 목록에 추가")은 반려했지만 이름을 지어낸 답
 * (#66 `process.env.FRONTEND_URL` — 실제는 `CORS_ORIGINS`)은 통과시켰다(8편 6-5). 이름 대조는 단어 단위의 기계적인 일이라
 * 사람에게 시키면 빠진다.
 *
 * 규칙(위에서부터 순서대로 적용):
 *  1. 코드 구간 = 코드펜스(```…```) 안 + 펜스 밖에서 "코드처럼 보이는 줄"(문자열·주석을 뺀 나머지에 한글이 없고 `=`·`(`·`{`·`;`·`=>`·JSX 가 있다)
 *     + 인라인 백틱 `…`(한글 없는 것). 설명 문장의 영어 단어를 코드로 오인하지 않기 위해 한글이 있는 줄은 코드가 아니다.
 *  2. 주석은 통째로 버리지 않는다 — v1.1 의 조치는 `// 수정 후: product.images?.find(...) || DEFAULT_IMAGE_URL` 처럼 **주석 안에만** 코드가 있다(#58).
 *     한글 머리말 뒤의 콜론(`수정 후:`)이 있으면 그 뒤를, 없으면 전체를 보고, 식별자 옆에 `.`·`(`·`=` 가 붙은 "표현식 꼴"일 때만 코드로 읽는다.
 *     `// NOTE: … Sentry …`·`// Error 대신 …` 같은 산문 주석은 그래서 걸리지 않는다(#65·#67).
 *  3. 문자열 리터럴 안은 이름이 아니다(템플릿의 `${…}` 안만 코드). 파일 경로(`a/b/c.ts`)·파일명(`main.ts`)·URL 은 지운다 —
 *     `// src/main.ts` 주석의 `src`·`main`·`ts` 가 이름으로 새지 않게.
 *  4. 빼는 이름: JS/TS 예약어 · 표준 전역·내장 메서드(`Array`·`isArray`·`map`·`console`·`JSON` …) · React/RN 기본(`useState`·`key`·`className`·`__DEV__` …) ·
 *     소문자 JSX 태그(HTML 요소 `<p>`·`<div>`) · `data-*`/`aria-*` 속성 · 한 글자 이름 ·
 *     **조치 코드 안에서 새로 선언한 이름**(`const acc`·`function f(nodes)`·`(product) =>`·`catch (e)`·import). 조치가 자기 안에서 붙인 이름은 지어낸 것이 아니다 —
 *     그래서 #66 의 `(origin, callback) =>` 의 `callback` 은 잡지 않는다(실제 이름은 `cb` 지만 조치의 매개변수라 자기 완결적이다). 인수인계 예상과 다른 점.
 *  5. 남은 이름이 소스 이름 집합에 **정확히**(대소문자 그대로) 없으면 unknown. 소스 쪽은 **주석을 벗기고** 이름을 모은다 — #66 의 `FRONTEND_URL` 은
 *     `main.ts` 52행 주석("이메일 링크용 FRONTEND_URL과 분리")에만 있어, 주석을 남기면 "코드에 있다"로 잘못 통과한다(2026-09-23 실측).
 *  6. unknown 중 `…Exception`·`…Module`·`…Service` 같은 프레임워크 클래스 꼴은 maybeLibrary 로 따로 낸다 — #67 의 `ForbiddenException` 은 NestJS 클래스라
 *     그 파일에 없을 뿐이다. 카드는 약하게 표시한다.
 *
 * 한계(잡지 못하는 것, 학습 노트 9편에 기록): 이름은 전부 실재하는데 코드를 **다시 쓴** 조치(#54 의 reduce 판 flattenTree) · JSX 속성 이름이 파일에
 * 다른 뜻으로 존재하는 경우(#56 `data={product}` — 파일에 `data` 변수가 있다) · 내장 이름 목록에 겹치는 앱 이름(`name`·`value`·`error`).
 */

export interface IdentifierCheckResult {
  /** 대조한 이름(중복 제거, 등장 순). 비어 있으면 조치에 코드 이름이 없다 */
  checked: string[];
  /** 소스 어디에도 없는 이름(등장 순) */
  unknown: string[];
  /** 없지만 프레임워크 클래스 꼴 — 라이브러리 이름일 수 있다 */
  maybeLibrary: string[];
}

const IDENT_RE = /[A-Za-z_$][\w$]*/g;
const HANGUL_RE = /[ㄱ-ㆎ가-힣]/;
/** 코드처럼 보이는 줄의 표식(문자열·주석을 뺀 뒤 검사) */
const CODE_LIKE_LINE_RE = /=>|[=({;]|<\/?[A-Z][\w.]*(?=[\s/>])/;
/** 주석 안의 "표현식 꼴" — 식별자에 `.`·`(`·`=`·`[` 가 붙거나 `=>`·`||`·`&&` 가 있다 */
const CODE_LIKE_COMMENT_RE = /[A-Za-z_$][\w$]*\s*[.(=[]|[.(]\s*[A-Za-z_$]|=>|\|\||&&/;
const LIBRARY_LIKE_RE =
  /^[A-Z][A-Za-z0-9]*(?:Exception|Error|Module|Service|Controller|Guard|Interceptor|Pipe|Filter|Decorator|Provider|Repository|Entity|Dto|Client|Adapter|Strategy)$/;

/** JS/TS 예약어·타입 키워드·리터럴 */
const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends',
  'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'implements', 'interface', 'package', 'private',
  'protected', 'public', 'await', 'async', 'of', 'as', 'from', 'get', 'set',
  'any', 'unknown', 'never', 'string', 'number', 'boolean', 'object', 'symbol', 'bigint', 'undefined', 'type', 'namespace', 'declare',
  'abstract', 'readonly', 'keyof', 'infer', 'is', 'satisfies', 'override', 'module', 'require', 'global', 'constructor',
]);

/** 표준 전역 · 내장 메서드 · 흔한 표준 속성. 파일에 없어도 "지어낸 이름"이 아니다 */
const BUILTINS = new Set([
  // 전역 객체·함수
  'Array', 'Object', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math', 'JSON', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError',
  'SyntaxError', 'ReferenceError', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'Reflect', 'Proxy', 'Intl', 'console', 'window',
  'document', 'navigator', 'globalThis', 'process', 'env', 'Buffer', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'queueMicrotask', 'structuredClone', 'fetch', 'Response', 'Request', 'Headers', 'URL', 'URLSearchParams', 'AbortController', 'AbortSignal',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'Infinity', 'NaN',
  'arguments', 'exports', '__dirname', '__filename', 'Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Exclude', 'Extract',
  'NonNullable', 'ReturnType', 'Parameters', 'Awaited', 'Promise', 'Iterable', 'IterableIterator', 'HTMLElement', 'HTMLSelectElement',
  'HTMLInputElement', 'Event', 'Element', 'Node', 'localStorage', 'sessionStorage', 'location', 'history', 'alert', 'confirm',
  // Array
  'length', 'map', 'filter', 'reduce', 'reduceRight', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every', 'forEach', 'push',
  'pop', 'shift', 'unshift', 'slice', 'splice', 'concat', 'join', 'includes', 'indexOf', 'lastIndexOf', 'flat', 'flatMap', 'sort', 'reverse',
  'fill', 'keys', 'values', 'entries', 'isArray', 'from', 'at', 'toSorted', 'toReversed',
  // Object
  'assign', 'freeze', 'create', 'defineProperty', 'getPrototypeOf', 'hasOwnProperty', 'hasOwn', 'fromEntries', 'toString', 'valueOf',
  // String
  'toISOString', 'toLocaleString', 'toLocaleDateString', 'toFixed', 'trim', 'trimStart', 'trimEnd', 'split', 'replace', 'replaceAll',
  'startsWith', 'endsWith', 'toLowerCase', 'toUpperCase', 'padStart', 'padEnd', 'charAt', 'charCodeAt', 'substring', 'substr', 'repeat',
  'test', 'match', 'matchAll', 'exec', 'normalize', 'localeCompare',
  // Promise
  'then', 'catch', 'finally', 'resolve', 'reject', 'all', 'allSettled', 'race',
  // console · Error
  'log', 'warn', 'error', 'info', 'debug', 'table', 'group', 'groupEnd', 'message', 'stack', 'name', 'cause',
  // JSON · Map/Set · Math · Number · Date
  'stringify', 'parse', 'has', 'add', 'clear', 'size', 'call', 'apply', 'bind', 'prototype', 'round', 'floor', 'ceil', 'max', 'min', 'abs',
  'random', 'pow', 'sqrt', 'trunc', 'sign', 'isInteger', 'isSafeInteger', 'now', 'getTime', 'next', 'done', 'value', 'iterator', 'asyncIterator',
]);

/** React / React Native 기본 — 훅·컴포넌트 속성·개발 플래그 */
const REACT_BUILTINS = new Set([
  'React', 'useState', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useContext', 'useReducer', 'useLayoutEffect', 'useId', 'useTransition',
  'useDeferredValue', 'useSyncExternalStore', 'Fragment', 'StrictMode', 'Suspense', 'memo', 'forwardRef', 'createContext', 'lazy', 'JSX',
  'key', 'ref', 'className', 'style', 'children', 'props', 'state', 'defaultProps', 'dangerouslySetInnerHTML', 'onClick', 'onChange',
  'onSubmit', 'onPress', 'onLongPress', 'href', 'src', 'alt', 'htmlFor', 'role', 'tabIndex', 'disabled', 'placeholder', 'target', 'rel',
  '__DEV__', 'testID', 'accessibilityLabel', 'accessibilityRole',
]);

function isExcluded(name: string): boolean {
  return name.length < 2 || RESERVED.has(name) || BUILTINS.has(name) || REACT_BUILTINS.has(name);
}

/**
 * 문자열을 알아보며 주석을 떼어 낸다. 문자열 안의 `//`(URL)·`/*` 는 주석이 아니다.
 * blankStrings=true 면 문자열 내용을 공백으로 바꾼다(템플릿의 `${…}` 안은 코드로 남긴다) — 조치 쪽.
 * false 면 문자열을 그대로 둔다 — 소스 쪽(느슨하게: 문자열 안 단어도 "그 파일에 있는 이름"으로 친다).
 */
export function splitCodeAndComments(input: string, blankStrings: boolean): { code: string; comments: string[] } {
  let code = '';
  const comments: string[] = [];
  const n = input.length;
  let i = 0;
  while (i < n) {
    const ch = input[i];
    const next = input[i + 1];
    if (ch === '/' && next === '/') {
      let j = i + 2;
      while (j < n && input[j] !== '\n') j++;
      comments.push(input.slice(i + 2, j));
      i = j;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = input.indexOf('*/', i + 2);
      const j = end === -1 ? n : end + 2;
      comments.push(input.slice(i + 2, end === -1 ? n : end));
      // 줄 수를 보존해야 할 이유는 없지만 토큰이 붙지 않게 공백 하나
      code += ' ';
      i = j;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      let body = '';
      while (j < n && input[j] !== ch && input[j] !== '\n') {
        if (input[j] === '\\') {
          body += input[j] + (input[j + 1] ?? '');
          j += 2;
          continue;
        }
        body += input[j];
        j++;
      }
      code += blankStrings ? ' ' : ch + body + ch;
      i = j + 1;
      continue;
    }
    if (ch === '`') {
      // 템플릿 리터럴: ${ … } 안만 코드
      let j = i + 1;
      let out = blankStrings ? ' ' : '`';
      while (j < n && input[j] !== '`') {
        if (input[j] === '\\') {
          if (!blankStrings) out += input[j] + (input[j + 1] ?? '');
          j += 2;
          continue;
        }
        if (input[j] === '$' && input[j + 1] === '{') {
          let depth = 1;
          let k = j + 2;
          while (k < n && depth > 0) {
            if (input[k] === '{') depth++;
            else if (input[k] === '}') depth--;
            if (depth > 0) k++;
          }
          out += ' ' + input.slice(j + 2, k) + ' ';
          j = k + 1;
          continue;
        }
        if (!blankStrings) out += input[j];
        j++;
      }
      code += out + (blankStrings ? ' ' : '`');
      i = j + 1;
      continue;
    }
    code += ch;
    i++;
  }
  return { code, comments };
}

/** 파일 경로·파일명·URL·`data-*`/`aria-*` 속성을 지운다 — 이름이 아닌데 식별자 정규식에 걸리는 것들 */
function stripNonIdentifierTokens(code: string): string {
  return code
    .replace(/\bhttps?:\/\/\S+/g, ' ')
    .replace(/(?:\.{1,2}\/|\/)?(?:[\w\-@.()[\]]+\/)+[\w\-@.()[\]]*/g, ' ')
    .replace(/\b[\w-]+\.(?:tsx?|jsx?|mjs|cjs|json|css|scss|md|ya?ml|env|png|jpg|svg)\b/g, ' ')
    .replace(/\b(?:data|aria)-[\w-]+/g, ' ')
    .replace(/<\/?[a-z][\w-]*(?=[\s/>])/g, ' ');
}

/**
 * 주석 텍스트에서 코드로 읽을 부분을 골라낸다. 산문이면 null.
 * `// 수정 후: product.images?.find(...) || X` → `product.images?.find(...) || X` · `// NOTE: … Sentry …` → null · `// src/main.ts` → null
 */
export function codeFromComment(comment: string): string | null {
  let t = comment.trim();
  if (!t) return null;
  const colon = t.indexOf(':');
  if (colon >= 0 && HANGUL_RE.test(t.slice(0, colon))) t = t.slice(colon + 1);
  t = stripNonIdentifierTokens(t);
  if (!CODE_LIKE_COMMENT_RE.test(t)) return null;
  // 한글이 붙은 덩어리는 산문이다(`log만`·`(에러`) — 통째로 버린다
  return t.replace(/\S*[ㄱ-ㆎ가-힣]\S*/g, ' ');
}

/** 매개변수 목록 `a, b: T = x, { c, d }` 에서 선언되는 이름(콜론·등호 앞쪽)을 모은다 */
function declaredFromParams(params: string, into: Set<string>): void {
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  for (let i = 0; i < params.length; i++) {
    const ch = params[i];
    if (ch === '(' || ch === '{' || ch === '[' || ch === '<') depth++;
    else if (ch === ')' || ch === '}' || ch === ']' || ch === '>') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(params.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(params.slice(start));
  for (const part of parts) {
    const lhs = part.split(/[:=]/, 1)[0];
    for (const m of lhs.match(IDENT_RE) ?? []) into.add(m);
  }
}

/** 조치 코드 안에서 새로 선언한 이름 — 자기 완결적인 이름은 대조 대상이 아니다 */
export function declaredNames(code: string): Set<string> {
  const out = new Set<string>();
  const addAll = (s: string | undefined) => {
    if (s) for (const m of s.match(IDENT_RE) ?? []) out.add(m);
  };
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*|\{[^}]*\}|\[[^\]]*\])/g)) addAll(m[1]);
  for (const m of code.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(([^()]*)\)/g)) {
    if (m[1]) out.add(m[1]);
    declaredFromParams(m[2], out);
  }
  // 반환 타입 `(a): T =>` 는 같은 줄 안에서만 — 줄을 넘게 두면 앞 함수의 매개변수 목록이 다음 줄의 `=>` 까지 삼킨다(단위 테스트로 잡힌 함정)
  for (const m of code.matchAll(/\(([^()]*)\)\s*(?::\s*[^=(){}\n]*?)?=>/g)) declaredFromParams(m[1], out);
  for (const m of code.matchAll(/(?<![\w$)\]])([A-Za-z_$][\w$]*)\s*=>/g)) out.add(m[1]);
  for (const m of code.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of code.matchAll(/\b(?:class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of code.matchAll(/\bimport\s+(?:type\s+)?([^;]*?)\s+from\b/g)) addAll(m[1]);
  return out;
}

/**
 * 조치 텍스트 → 코드 구간 목록(펜스 안 · 코드 같은 줄 · 인라인 백틱). 주석은 여기서 처리하지 않는다(extractIdentifiers 가 한다).
 */
export function extractCodeSegments(fixText: string): string[] {
  const segments: string[] = [];
  let rest = (fixText ?? '').replace(/\r\n?/g, '\n');
  rest = rest.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_m, body: string) => {
    segments.push(body);
    return '\n';
  });
  for (const line of rest.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('//')) {
      // 주석만 있는 줄 — 주석 규칙으로 읽는다(#58 처럼 조치 전체가 주석일 수 있다)
      segments.push(trimmed);
      continue;
    }
    const { code } = splitCodeAndComments(trimmed, true);
    if (!HANGUL_RE.test(code) && CODE_LIKE_LINE_RE.test(code)) {
      segments.push(trimmed);
      continue;
    }
    // 산문 줄 — 인라인 백틱 `…` 만 코드다
    for (const m of trimmed.matchAll(/`([^`\n]+)`/g)) {
      if (!HANGUL_RE.test(m[1])) segments.push(m[1]);
    }
  }
  return segments;
}

/**
 * 조치 텍스트에서 대조할 이름을 뽑는다(등장 순, 중복 제거). 선언한 이름·예약어·내장·한 글자는 뺀다.
 */
export function extractIdentifiers(fixText: string): string[] {
  const referenced: string[] = [];
  const declared = new Set<string>();
  const seen = new Set<string>();

  const consume = (code: string) => {
    const cleaned = stripNonIdentifierTokens(code);
    for (const d of declaredNames(cleaned)) declared.add(d);
    for (const m of cleaned.match(IDENT_RE) ?? []) {
      if (seen.has(m)) continue;
      seen.add(m);
      referenced.push(m);
    }
  };

  for (const segment of extractCodeSegments(fixText)) {
    const { code, comments } = splitCodeAndComments(segment, true);
    consume(code);
    for (const c of comments) {
      const fromComment = codeFromComment(c);
      if (fromComment) consume(fromComment);
    }
  }
  return referenced.filter((name) => !declared.has(name) && !isExcluded(name));
}

/** 소스 파일들의 이름 집합 — **주석을 벗기고**(규칙 5) 식별자 정규식으로 모은다. 문자열 안은 남긴다(느슨한 쪽이 거짓 양성을 줄인다) */
export function buildSourceIndex(sourceTexts: string[]): Set<string> {
  const out = new Set<string>();
  for (const text of sourceTexts) {
    const { code } = splitCodeAndComments(text ?? '', false);
    for (const m of code.match(IDENT_RE) ?? []) out.add(m);
  }
  return out;
}

/** 대조 본체. sourceTexts 가 비어 있으면 모두 unknown 이 되므로 호출 측이 "대조할 코드 없음"을 따로 다룬다 */
export function findUnknownIdentifiers(fixText: string, sourceTexts: string[]): IdentifierCheckResult {
  const checked = extractIdentifiers(fixText);
  const index = buildSourceIndex(sourceTexts);
  const unknown: string[] = [];
  const maybeLibrary: string[] = [];
  for (const name of checked) {
    if (index.has(name)) continue;
    if (LIBRARY_LIKE_RE.test(name)) maybeLibrary.push(name);
    else unknown.push(name);
  }
  return { checked, unknown, maybeLibrary };
}
