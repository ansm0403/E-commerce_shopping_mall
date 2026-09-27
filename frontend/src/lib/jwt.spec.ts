import { decodeJwtPayload, getTokenRoles, tokenHasRole, type AccessTokenPayload } from './jwt';

/**
 * 테스트용 JWT 생성 — 서명은 아무 값이어도 된다(decodeJwtPayload 는 서명을 보지 않는다).
 * 실제 토큰처럼 base64url(`+`→`-`, `/`→`_`) 로 바꾸고 `=` 패딩을 뗀다.
 * atob 대칭으로, UTF-8(한글 이메일 등)은 퍼센트 인코딩을 거쳐 latin1 바이트열로 만든다.
 */
function makeToken(payload: Record<string, unknown>): string {
  const toBase64Url = (obj: Record<string, unknown>) => {
    const json = JSON.stringify(obj);
    const latin1 = encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
    return btoa(latin1).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  return `${toBase64Url({ alg: 'HS256', typ: 'JWT' })}.${toBase64Url(payload)}.signature-not-checked`;
}

const NOW_SEC = Math.floor(new Date('2026-09-28T12:00:00Z').getTime() / 1000);

describe('decodeJwtPayload — 서명 검증 없는 payload 판독(UI 판단용)', () => {
  it('정상 토큰: sub·roles·exp 를 그대로 읽는다', () => {
    const token = makeToken({
      sub: 42,
      email: 'seller@example.com',
      type: 'access',
      roles: ['buyer', 'seller'],
      iat: NOW_SEC - 60,
      exp: NOW_SEC + 15 * 60,
      jti: 'b7f3c2e1-0000-4000-8000-000000000000',
    });

    const payload = decodeJwtPayload(token);

    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe(42);
    expect(payload?.roles).toEqual(['buyer', 'seller']);
    expect(payload?.exp).toBe(NOW_SEC + 15 * 60);
  });

  it('만료된 토큰도 payload 는 읽힌다 — 만료 판정은 호출부(백엔드 401) 몫이라 여기서 거르지 않는다', () => {
    const token = makeToken({ sub: 42, email: 'a@b.c', type: 'access', roles: ['buyer'], exp: NOW_SEC - 1 });

    const payload = decodeJwtPayload(token) as AccessTokenPayload;

    expect(payload.exp).toBeLessThan(NOW_SEC);
    expect(payload.roles).toEqual(['buyer']);
  });

  it('base64url 문자(-, _)와 패딩 없는 payload 를 복원한다 — 표준 base64 로 착각하면 깨지는 자리', () => {
    // 한글 + 특수문자를 넣어 base64 에 +, / 가 나오도록 유도한다
    const email = '판매자_테스트+tag@쇼핑몰.kr??>>';
    const token = makeToken({ sub: 7, email, type: 'access' });

    expect(token).not.toMatch(/[+/=]/);
    expect(decodeJwtPayload(token)?.email).toBe(email);
  });

  it.each([
    ['빈 문자열', ''],
    ['점이 없는 문자열', 'not-a-jwt'],
    ['payload 자리가 비었음', 'header..sig'],
    ['base64 가 아닌 payload', 'header.@@@@.sig'],
    ['JSON 이 아닌 payload', `header.${btoa('hello')}.sig`],
  ])('깨진 토큰(%s)은 throw 하지 않고 null — 호출부는 "모름"으로 취급', (_label, token) => {
    expect(decodeJwtPayload(token)).toBeNull();
  });
});

describe('getTokenRoles / tokenHasRole — 저장된 토큰 기준 역할 판독', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('저장된 토큰이 없으면 판단 불가 → getTokenRoles null, tokenHasRole false', () => {
    expect(getTokenRoles()).toBeNull();
    expect(tokenHasRole('seller')).toBe(false);
  });

  it('토큰에 roles 가 있으면 그 배열을 돌려주고, 역할 포함 여부를 답한다', () => {
    sessionStorage.setItem('accessToken', makeToken({ sub: 42, email: 'a@b.c', type: 'access', roles: ['buyer'] }));

    expect(getTokenRoles()).toEqual(['buyer']);
    expect(tokenHasRole('buyer')).toBe(true);
    // 승인 직후의 낡은 토큰 — DB 는 seller 인데 토큰엔 없다. 이 false 가 refresh 1회 트리거의 근거다.
    expect(tokenHasRole('seller')).toBe(false);
  });

  it('rememberMe 토큰(localStorage)도 읽는다', () => {
    localStorage.setItem('accessToken', makeToken({ sub: 1, email: 'a@b.c', type: 'access', roles: ['admin'] }));

    expect(tokenHasRole('admin')).toBe(true);
  });

  it('roles 클레임이 없거나 토큰이 깨졌으면 null / false', () => {
    sessionStorage.setItem('accessToken', makeToken({ sub: 1, email: 'a@b.c', type: 'access' }));
    expect(getTokenRoles()).toBeNull();

    sessionStorage.setItem('accessToken', 'garbage');
    expect(getTokenRoles()).toBeNull();
    expect(tokenHasRole('buyer')).toBe(false);
  });
});
