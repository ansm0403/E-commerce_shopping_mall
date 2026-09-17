/**
 * 토큰 저장소 — expo-secure-store(OS 키체인/키스토어) 래퍼.
 *
 * SecureStore 는 웹의 httpOnly 쿠키에 대응하는 보호 수단이다. OS 보안 저장소에 들어가므로
 * 일반 앱 코드나 디컴파일로 꺼내기 어렵다. **AsyncStorage 에 토큰을 저장하면 안 된다**(평문) —
 * 설계 §5.6 보안 노트·§7 ②.
 *
 * 메모리 캐시를 함께 두는 이유: axios 요청 인터셉터는 매 요청마다 토큰을 필요로 하는데,
 * SecureStore 는 비동기 네이티브 호출이라 매번 읽으면 느리다. 앱이 살아 있는 동안은
 * 메모리 값을 쓰고, 앱 재시작 때만 SecureStore 에서 복원한다.
 */
import * as SecureStore from 'expo-secure-store';

const ACCESS_KEY = 'ops.accessToken';
const REFRESH_KEY = 'ops.refreshToken';

let accessToken: string | null = null;
let refreshToken: string | null = null;

/** 앱 부팅 시 1회 — 저장된 토큰을 메모리로 복원한다. */
export async function loadTokens(): Promise<{ accessToken: string | null; refreshToken: string | null }> {
  [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
  ]);
  return { accessToken, refreshToken };
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

/** 로그인·갱신 성공 시 — 메모리와 SecureStore 양쪽을 갱신한다. */
export async function saveTokens(tokens: { accessToken: string; refreshToken?: string | null }): Promise<void> {
  accessToken = tokens.accessToken;
  const writes = [SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken)];

  // refresh 는 1회용 회전이라 응답에 새 값이 오면 반드시 갈아끼워야 다음 갱신이 성공한다.
  if (tokens.refreshToken) {
    refreshToken = tokens.refreshToken;
    writes.push(SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken));
  }
  await Promise.all(writes);
}

/** 로그아웃 — 저장소에서 지운다(설계 §7 ③ 로그아웃 시 토큰 삭제 확인). */
export async function clearTokens(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
}
