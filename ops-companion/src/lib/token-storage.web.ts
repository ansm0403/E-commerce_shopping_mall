/**
 * 토큰 저장소 — 웹 체험판 전용(Metro 가 웹 번들에서만 이 파일을 고른다. iOS·안드로이드는 token-storage.ts).
 *
 * 웹에는 SecureStore(OS 키체인/키스토어)가 없다 — expo-secure-store 는 웹 구현이 비어 있어
 * 부르는 순간 `deleteValueWithKeyAsync is not a function` 으로 앱 전체가 멈춘다.
 * 그래서 브라우저 저장소를 쓰되, localStorage 가 아니라 **sessionStorage** 를 쓴다.
 *  - 탭을 닫으면 토큰이 사라진다 → 새로고침은 살아남고, 남의 PC 에 로그인이 남지 않는다.
 *  - 웹 체험판은 "데모 계정으로 체험하기" 버튼 한 번이 로그인이라 다시 들어오는 비용이 작다.
 * 쇼핑몰 웹처럼 refresh 를 httpOnly 쿠키로 둘 수 없는 이유: 앱과 같은 `X-Client: mobile` 경로를
 * 타서 refreshToken 이 응답 body 로 온다(설계 §5.6). 코드를 한 벌로 유지하려는 선택이다.
 *
 * 메모리 캐시와 함수 모양은 네이티브 파일과 같다 — 호출하는 쪽은 플랫폼을 모른다.
 */
const ACCESS_KEY = 'ops.accessToken';
const REFRESH_KEY = 'ops.refreshToken';

let accessToken: string | null = null;
let refreshToken: string | null = null;

/** 사파리 사생활 보호 모드·인앱 브라우저는 저장소 접근이 던질 수 있다. 그때는 메모리만 쓴다. */
function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // 저장 실패 = 새로고침하면 로그아웃될 뿐, 지금 화면은 메모리 값으로 계속 동작한다.
  }
}

export async function loadTokens(): Promise<{ accessToken: string | null; refreshToken: string | null }> {
  accessToken = read(ACCESS_KEY);
  refreshToken = read(REFRESH_KEY);
  return { accessToken, refreshToken };
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

export async function saveTokens(tokens: { accessToken: string; refreshToken?: string | null }): Promise<void> {
  accessToken = tokens.accessToken;
  write(ACCESS_KEY, tokens.accessToken);

  // refresh 는 1회용 회전이라 응답에 새 값이 오면 반드시 갈아끼워야 다음 갱신이 성공한다.
  if (tokens.refreshToken) {
    refreshToken = tokens.refreshToken;
    write(REFRESH_KEY, tokens.refreshToken);
  }
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  write(ACCESS_KEY, null);
  write(REFRESH_KEY, null);
}
