/**
 * 전역 인증 상태 (설계 §2 · §4.1).
 *
 * 화면 전환을 `navigate('/login')` 같은 명령으로 하지 않는다. user 가 null 이면 로그인 화면을,
 * 있으면 탭 화면을 **렌더 분기**로 보여준다(설계 §4.1). 명령형 이동은 "로그아웃했는데 화면이
 * 남아 있는" 상태를 만들기 쉽다.
 *
 * 부팅 절차:
 *   SecureStore 에서 토큰 복원 → 있으면 GET /auth/me 로 검증(만료면 axios 인터셉터가 refresh 1회)
 *   → 성공하면 로그인 상태로 시작. 이것이 "앱 재시작 후에도 로그인 유지"(Phase 0 DoD)의 구현이다.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AuthUser,
  demoLogin as demoLoginRequest,
  fetchMe,
  login as loginRequest,
  logout as logoutRequest,
  setSessionExpiredHandler,
  type LoginResponse,
} from '../lib/api';
import { clearTokens, loadTokens, saveTokens } from '../lib/token-storage';
import { setSentryUser } from '../lib/sentry';

interface AuthContextValue {
  user: AuthUser | null;
  /** 부팅 중 토큰 복원·검증이 끝나기 전 true. 이 동안 스플래시를 유지한다. */
  isBooting: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /** 포트폴리오 방문자용 — 비밀번호 없이 데모 관리자로. 토큰 저장·상태 전환은 signIn 과 같다 */
  signInDemo: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isBooting, setIsBooting] = useState(true);

  // 갱신까지 실패해 세션이 끝나면 axios 인터셉터가 이 핸들러로 알려준다 → 렌더 분기가 로그인 화면으로.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      setSentryUser(null);
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { accessToken } = await loadTokens();
        if (!accessToken) return;

        const me = await fetchMe();
        if (!cancelled) {
          setUser(me);
          setSentryUser(me.id);
        }
      } catch {
        // 저장된 토큰이 더 이상 쓸 수 없으면(만료·서버 무효화) 지우고 로그인부터 다시.
        await clearTokens();
      } finally {
        if (!cancelled) setIsBooting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 로그인 응답을 세션으로 만드는 한 자리 — 일반 로그인과 데모 로그인이 같은 길을 탄다(토큰 저장 → user → Sentry 태그).
  const adopt = useCallback(async (result: LoginResponse) => {
    await saveTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    setUser(result.user);
    setSentryUser(result.user.id);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => adopt(await loginRequest(email, password)), [adopt]);
  const signInDemo = useCallback(async () => adopt(await demoLoginRequest()), [adopt]);

  const signOut = useCallback(async () => {
    await logoutRequest();
    setUser(null);
    setSentryUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, isBooting, signIn, signInDemo, signOut }),
    [user, isBooting, signIn, signInDemo, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 는 AuthProvider 안에서만 쓸 수 있습니다.');
  return ctx;
}
