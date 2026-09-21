/**
 * 생체 잠금 상태 (설계 §4.3 S1).
 *
 * **잠금은 화면 이동이 아니라 덮개다.** 로그인 분기처럼 라우트를 갈아끼우지 않고, 내비게이터
 * 위에 불투명한 화면을 덮는다. 그래야 잠긴 동안에도 뒤에서 딥링크 이동이 정상으로 일어나고
 * (usePushRouting 이 router.push 를 부른다), 잠금을 풀면 알림이 가리키던 인시던트 상세가
 * 이미 떠 있다. 라우트로 만들면 "잠금 화면으로 갔다가 원래 목적지로 되돌아가는" 처리를
 * 푸시 딥링크와 또 한 벌 만들어야 한다.
 *
 * 잠그는 시점은 둘이다.
 *   ① 앱을 켤 때 — 저장된 세션으로 자동 로그인되는 그 순간
 *   ② 백그라운드에 오래 머물다 돌아올 때 — 폰을 책상에 두고 자리를 뜬 경우
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { isBiometricLockEnabled } from '../../lib/biometrics';

/**
 * 이 시간을 넘겨 백그라운드에 있었으면 돌아올 때 다시 잠근다.
 * 0 으로 두면 알림을 확인하거나 비밀번호 앱을 잠깐 다녀올 때마다 잠겨서 쓸 수가 없다.
 */
const RELOCK_AFTER_MS = 60_000;

interface BiometricLockValue {
  /** true 면 잠금 덮개를 그린다 */
  isLocked: boolean;
  /** 인증에 성공했을 때 호출 — 덮개를 걷는다 */
  unlock: () => void;
}

const BiometricLockContext = createContext<BiometricLockValue | null>(null);

export function BiometricLockProvider({ children }: { children: ReactNode }) {
  const { user, isBooting } = useAuth();
  const [isLocked, setIsLocked] = useState(false);
  /** 앱 실행당 최초 판정을 한 번만 하기 위한 표식 */
  const bootChecked = useRef(false);
  /** 백그라운드로 내려간 시각 */
  const backgroundedAt = useRef<number | null>(null);

  const unlock = useCallback(() => setIsLocked(false), []);

  // ① 앱을 켤 때. 부팅(토큰 복원 + /auth/me)이 끝나고 로그인 상태일 때만 판정한다.
  useEffect(() => {
    if (isBooting || bootChecked.current) return;
    bootChecked.current = true;

    if (!user) return;
    void isBiometricLockEnabled().then((enabled) => {
      if (enabled) setIsLocked(true);
    });
  }, [isBooting, user]);

  // ② 백그라운드에서 돌아올 때.
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        // 이미 잠겨 있으면 시각을 덮어쓰지 않는다 — 잠긴 채로 오래 두면 그대로 잠겨 있어야 한다.
        if (backgroundedAt.current === null) backgroundedAt.current = Date.now();
        return;
      }

      if (next !== 'active') return;
      const since = backgroundedAt.current;
      backgroundedAt.current = null;
      if (since === null || Date.now() - since < RELOCK_AFTER_MS) return;

      void isBiometricLockEnabled().then((enabled) => {
        // 로그아웃 상태면 잠글 세션 자체가 없다. 로그인 화면을 덮개로 가리면 안 된다.
        if (enabled && user) setIsLocked(true);
      });
    };

    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, [user]);

  // 로그아웃하면 잠금도 의미가 없다. 남겨 두면 다시 로그인했을 때 덮개가 남는다.
  useEffect(() => {
    if (!user) setIsLocked(false);
  }, [user]);

  const value = useMemo(() => ({ isLocked, unlock }), [isLocked, unlock]);
  return <BiometricLockContext.Provider value={value}>{children}</BiometricLockContext.Provider>;
}

export function useBiometricLock(): BiometricLockValue {
  const ctx = useContext(BiometricLockContext);
  if (!ctx) throw new Error('useBiometricLock 은 BiometricLockProvider 안에서만 쓸 수 있습니다.');
  return ctx;
}
