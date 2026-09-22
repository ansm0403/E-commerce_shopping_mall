import * as fs from 'fs';
import * as path from 'path';
import {
  buildSourceIndex,
  codeFromComment,
  declaredNames,
  extractCodeSegments,
  extractIdentifiers,
  findUnknownIdentifiers,
  splitCodeAndComments,
} from './identifier-check';

/**
 * 이름 대조(Phase 8 A) 단위 테스트 — 규칙 하나씩 + 2026-09-22 평가 세트 14장(#54~#67)의 **실제 텍스트** 픽스처.
 * 픽스처의 expected 는 인수인계 문서의 "사전 점검(예상)"과 다른 곳이 셋 있다(2026-09-23 실측):
 *  - #60 `ProductItem` 은 예상에 없었지만 진짜 지어낸 이름이다(실제 컴포넌트는 ProductCard)
 *  - #66 `callback` 은 조치의 매개변수라 잡지 않는다(규칙 4) — `FRONTEND_URL` 만
 *  - #56 `data={product}` 는 잡지 못한다 — 파일에 `data` 변수가 있어 단어 대조로는 보이지 않는다(한계)
 */
describe('identifier-check — 조치 코드 이름 대조(설계 §9 Phase 8 A)', () => {
  describe('splitCodeAndComments — 문자열을 알아보는 주석 분리', () => {
    it('// 와 /* */ 를 떼어 comments 로, 문자열 안의 // 는 주석이 아니다', () => {
      const { code, comments } = splitCodeAndComments(`const u = 'https://a.b/c'; // 주소\n/* 블록 */ x();`, true);
      expect(comments).toEqual([' 주소', ' 블록 ']);
      expect(code).not.toMatch(/https/);
      expect(code).toMatch(/x\(\)/);
    });

    it('blankStrings=true 면 문자열 내용이 사라지고 템플릿의 ${…} 안만 남는다', () => {
      const { code } = splitCodeAndComments('Alert.alert(\'Sentry Test\', `Test event sent: ${eventId}`);', true);
      expect(code).toMatch(/eventId/);
      expect(code).not.toMatch(/Sentry|Test|sent/);
    });

    it('blankStrings=false 면 문자열을 그대로 둔다(소스 쪽)', () => {
      const { code } = splitCodeAndComments(`cb(new Error('Not allowed by CORS')) // 차단`, false);
      expect(code).toMatch(/Not allowed by CORS/);
      expect(code).not.toMatch(/차단/);
    });
  });

  describe('codeFromComment — 주석에서 코드만', () => {
    it('한글 머리말 뒤 콜론이 있으면 그 뒤를 표현식으로 읽는다(#58 꼴)', () => {
      expect(codeFromComment(' 수정 후: product.images?.find(...) || DEFAULT_IMAGE_URL')).toMatch(/product\.images\?\.find\(\.\.\.\) \|\| DEFAULT_IMAGE_URL/);
    });

    it('산문 주석은 null — NOTE: … · Error 대신 … · (에러 던지는 대신 log만 …)', () => {
      expect(codeFromComment(' NOTE: 다음 함수 호출은 Sentry 정상 연동을 확인하기 위한 테스트용입니다.')).toBeNull();
      expect(codeFromComment(' Error 대신 예외 처리로 로깅 레벨 조정 고려')).toBeNull();
      expect(codeFromComment(' 수정 제안 (에러 던지는 대신 log만 남기거나 무시)')).toBeNull();
      expect(codeFromComment(' Sentry 보고를 피하기 위해 silent 하게 처리하거나 로직 수정')).toBeNull();
    });

    it('경로만 있는 주석은 null — src/main.ts · frontend/src/hooks/useCategories.ts 수정', () => {
      expect(codeFromComment(' src/main.ts')).toBeNull();
      expect(codeFromComment(' frontend/src/hooks/useCategories.ts 수정')).toBeNull();
      expect(codeFromComment(' /ops-companion/app/(tabs)/profile.tsx')).toBeNull();
    });
  });

  describe('extractCodeSegments — 코드 구간 고르기', () => {
    it('코드펜스 안 · 한글 없는 코드 같은 줄 · 인라인 백틱을 고르고, 한글 산문 줄은 버린다', () => {
      const text = [
        'ProductSection.tsx 내 .map 함수에서 데이터 요소의 null 체크를 추가하십시오. 코드 예시: ',
        '',
        '{products?.map((product) => (',
        '  <ProductCard key={product.id} data={product} />',
        '))}',
        '그리고 `Array.isArray(products)` 로 감싸세요. 55행을 보세요.',
        '```tsx',
        'const x = 1;',
        '```',
      ].join('\n');
      expect(extractCodeSegments(text)).toEqual([
        'const x = 1;\n',
        '{products?.map((product) => (',
        '<ProductCard key={product.id} data={product} />',
        'Array.isArray(products)',
      ]);
    });

    it('주석만 있는 줄도 구간이다(#58 은 조치 전체가 주석) · 한글 문자열이 있는 코드 줄은 코드다(#64)', () => {
      expect(extractCodeSegments('// 수정 후: a.b() || X')).toEqual(['// 수정 후: a.b() || X']);
      expect(extractCodeSegments("console.warn('테스트 모드에서만 실행 가능합니다.');")).toEqual(["console.warn('테스트 모드에서만 실행 가능합니다.');"]);
    });
  });

  describe('declaredNames — 조치가 스스로 선언한 이름', () => {
    it('const/let/var · 구조분해 · function 이름과 매개변수 · 화살표 매개변수(타입·기본값 포함) · catch · class/type · import', () => {
      const code = [
        'const acc = 1; let { data: tree = [], isLoading } = q(); var [first, second] = arr;',
        'function flattenTree(nodes: CategoryTreeNode[], result: CategoryTreeNode[] = []): CategoryTreeNode[] {}',
        'nodes.reduce((acc2, node) => acc2, []); items.map(item => item.id); origin: (origin, callback) => {}',
        'try {} catch (err) {} class Foo {} type Bar = 1; interface Baz {}',
        "import { Alert, View } from 'react-native'; import * as Sentry from '@sentry/react-native';",
      ].join('\n');
      const d = declaredNames(code);
      for (const name of ['acc', 'data', 'tree', 'isLoading', 'first', 'second', 'flattenTree', 'nodes', 'result', 'acc2', 'node', 'item', 'origin', 'callback', 'err', 'Foo', 'Bar', 'Baz', 'Alert', 'View', 'Sentry']) {
        expect(d.has(name)).toBe(true);
      }
      // 타입 주석의 이름은 선언이 아니다(파일에 있어야 한다)
      expect(d.has('CategoryTreeNode')).toBe(false);
    });
  });

  describe('extractIdentifiers — 빼는 것들', () => {
    it('예약어 · 내장(Array/isArray/map/console/JSON/process.env) · React 기본(key/className/__DEV__) · 소문자 HTML 태그 · data-* · 한 글자', () => {
      const fix = '```tsx\nif (__DEV__ && Array.isArray(xs)) { console.log(JSON.stringify(process.env.FOO)); }\n' +
        'return <p className="x" data-testid="t" key={i}>{xs.map((x) => <Item key={x.id} onClick={go} />)}</p>;\n```';
      expect(extractIdentifiers(fix)).toEqual(['xs', 'FOO', 'Item', 'id', 'go']);
    });

    it('문자열 안 단어 · 경로 · 파일명 · URL 은 이름이 아니다', () => {
      const fix = "```ts\n// src/main.ts\nfetch('https://api.example.com/v1/x', { method: 'GET' });\nrequire('./frontend/src/hooks/useCategories.ts');\nconst u = `${base}/products`;\n```";
      expect(extractIdentifiers(fix)).toEqual(['method', 'base']);
    });

    it('조치가 선언한 이름은 대조하지 않는다 — #66 의 callback 은 잡히지 않고 FRONTEND_URL 만 남는다', () => {
      const fix = '```typescript\napp.enableCors({\n  origin: (origin, callback) => {\n    const allowedOrigins = [process.env.FRONTEND_URL];\n    if (!origin || allowedOrigins.includes(origin)) callback(null, true);\n    else callback(new Error(\'Not allowed by CORS\'));\n  },\n});\n```';
      expect(extractIdentifiers(fix)).toEqual(['app', 'enableCors', 'FRONTEND_URL']);
    });

    it('코드가 전혀 없는 산문 조치 → 빈 배열(호출 측이 파일을 읽지 않는다)', () => {
      expect(extractIdentifiers('조치 없음')).toEqual([]);
      expect(extractIdentifiers('이것은 보안 장치가 의도한 대로 동작하고 있는 것이므로 코드를 수정할 필요는 없습니다.')).toEqual([]);
      expect(extractIdentifiers('')).toEqual([]);
    });
  });

  describe('buildSourceIndex — 소스 쪽은 주석을 벗긴다', () => {
    it('주석에만 있는 이름은 "코드에 있는 이름"이 아니다(#66 FRONTEND_URL 이 main.ts 52행 주석에만 있던 함정) · 문자열은 남긴다', () => {
      const idx = buildSourceIndex([
        "// CORS_ORIGINS: 허용 origin 목록 (이메일 링크용 FRONTEND_URL과 분리)\nconst allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',');\ncb(new Error('Not allowed by CORS'));",
      ]);
      expect(idx.has('CORS_ORIGINS')).toBe(true);
      expect(idx.has('allowedOrigins')).toBe(true);
      expect(idx.has('FRONTEND_URL')).toBe(false);
      expect(idx.has('CORS')).toBe(true);
    });
  });

  describe('findUnknownIdentifiers — 판정과 라이브러리 꼴 구분', () => {
    it('없는 이름은 unknown, …Exception 꼴은 maybeLibrary(#67 ForbiddenException)', () => {
      const r = findUnknownIdentifiers(
        'return cb(new ForbiddenException(\'CORS policy\')); // Error 대신\nconst v = MISSING_ENV;',
        ['const cb = () => {};'],
      );
      expect(r).toEqual({ checked: ['cb', 'ForbiddenException', 'MISSING_ENV'], unknown: ['MISSING_ENV'], maybeLibrary: ['ForbiddenException'] });
    });

    it('대소문자는 구분한다 — productCard 와 ProductCard 는 다른 이름 · 소문자 JSX 태그는 HTML 요소라 이름이 아니다', () => {
      const r = findUnknownIdentifiers('```\nproductCard.render();\nreturn <section><ProductCard /></section>;\n```', ['function ProductCard() {}']);
      expect(r.unknown).toEqual(['productCard', 'render']);
      expect(r.checked).toEqual(['productCard', 'render', 'ProductCard']);
    });
  });

  describe('2026-09-22 평가 세트 14장(#54~#67) — 실제 텍스트 대조', () => {
    interface Fixture {
      cases: Array<{ analysisId: number; arm: string; incidentId: string; ref: string; files: string[]; suggestedFix: string; expected: { unknown: string[]; maybeLibrary: string[] } }>;
      sources: Record<string, string>;
    }
    const fixture: Fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', 'identifier-check.phase8.json'), 'utf8'));

    it.each(fixture.cases.map((c) => [c.analysisId, c.arm, c] as const))('#%i %s', (_id, _arm, c) => {
      const texts = c.files.map((f) => fixture.sources[`${c.ref}:${f}`]).filter((t): t is string => typeof t === 'string');
      expect(texts.length).toBe(c.files.length);
      const r = findUnknownIdentifiers(c.suggestedFix, texts);
      expect({ unknown: r.unknown, maybeLibrary: r.maybeLibrary }).toEqual(c.expected);
    });

    it('DoD (A)1 — v1.1 에서 3건 이상 잡히고, v3.1 의 unknown 은 0 (maybeLibrary 는 #67 한 건)', () => {
      const byArm = (arm: string) => fixture.cases.filter((c) => c.arm === arm);
      const caught = (arm: string) =>
        byArm(arm).filter((c) => {
          const texts = c.files.map((f) => fixture.sources[`${c.ref}:${f}`]);
          return findUnknownIdentifiers(c.suggestedFix, texts).unknown.length > 0;
        });
      expect(caught('v1.1').map((c) => c.analysisId)).toEqual([58, 60, 62, 66]);
      expect(caught('v3.1')).toEqual([]);
      const lib = byArm('v3.1').filter((c) => findUnknownIdentifiers(c.suggestedFix, c.files.map((f) => fixture.sources[`${c.ref}:${f}`])).maybeLibrary.length > 0);
      expect(lib.map((c) => c.analysisId)).toEqual([67]);
    });
  });
});
