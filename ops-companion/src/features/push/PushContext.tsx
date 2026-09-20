/**
 * 푸시 등록 상태를 앱 전체에 하나만 둔다.
 *
 * 등록은 **로그인한 뒤** 해야 한다. 백엔드의 `POST /v1/ops/devices` 가 관리자 토큰을 요구하고,
 * 저장되는 것도 "이 사용자의 기기"이기 때문이다. 그래서 user 가 생기는 순간 한 번 등록하고,
 * 로그아웃하면 상태를 비운다(다른 사람이 로그인하면 그 사람 기기로 다시 등록된다).
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { registerForPushNotifications, type PushRegistration } from '../../lib/notifications';

interface PushContextValue {
  registration: PushRegistration | null;
  /** 프로필 화면의 "다시 시도" — 권한을 나중에 허용한 경우를 위해 필요하다 */
  retry: () => Promise<void>;
}

const PushContext = createContext<PushContextValue | null>(null);

export function PushProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [registration, setRegistration] = useState<PushRegistration | null>(null);

  const register = useCallback(async () => {
    const result = await registerForPushNotifications();
    setRegistration(result);
  }, []);

  useEffect(() => {
    if (user === null) {
      setRegistration(null);
      return;
    }
    void register();
  }, [user, register]);

  return (
    <PushContext.Provider value={{ registration, retry: register }}>{children}</PushContext.Provider>
  );
}

export function usePush(): PushContextValue {
  const ctx = useContext(PushContext);
  if (!ctx) throw new Error('usePush 는 PushProvider 안에서만 쓸 수 있습니다.');
  return ctx;
}
