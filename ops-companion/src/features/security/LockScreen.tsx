/**
 * 잠금 덮개 (설계 §4.3 S1).
 *
 * 내비게이터 **위에** 불투명하게 덮는다(BiometricLockContext 주석 참고). 화면이 열려 있는
 * 상태에서 가리는 것이므로, 뒤에 있던 내용이 비치지 않도록 배경을 반드시 채운다.
 *
 * 나가는 길을 두 개 둔다 — 인증 재시도와 **로그아웃**이다. 지문이 안 읽히는 상황(손을 다쳤거나
 * 센서 고장)에서 로그아웃조차 못 하면 앱을 지우는 것 말고 방법이 없어진다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { promptBiometric } from '../../lib/biometrics';
import { useBiometricLock } from './BiometricLockContext';
import { colors, spacing } from '../../theme';

/** 사용자가 취소한 것은 실패가 아니다 — "인증에 실패했습니다" 를 띄우면 겁을 준다. */
function messageFor(error: string | undefined): string {
  if (error === 'user_cancel' || error === 'system_cancel' || error === 'app_cancel') {
    return '잠금을 해제하면 계속 사용할 수 있습니다.';
  }
  if (error === 'lockout') {
    return '시도 횟수를 초과했습니다. 잠시 후 다시 시도하거나 로그아웃하세요.';
  }
  if (error === 'not_enrolled' || error === 'passcode_not_set') {
    return '기기에 등록된 생체 정보가 없습니다. 로그아웃 후 다시 로그인하세요.';
  }
  return '인증하지 못했습니다. 다시 시도해주세요.';
}

export function LockScreen() {
  const { unlock } = useBiometricLock();
  const { signOut } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [isPrompting, setIsPrompting] = useState(false);
  /** 인증 창이 두 번 겹쳐 뜨는 것을 막는다(마운트 자동 실행 + 사용자의 빠른 재시도) */
  const inFlight = useRef(false);

  const authenticate = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsPrompting(true);
    try {
      const result = await promptBiometric('Ops Companion 잠금 해제');
      if (result.success) unlock();
      else setMessage(messageFor(result.error));
    } catch {
      setMessage('인증하지 못했습니다. 다시 시도해주세요.');
    } finally {
      inFlight.current = false;
      setIsPrompting(false);
    }
  }, [unlock]);

  // 덮개가 뜨면 바로 인증 창을 띄운다. 버튼을 한 번 더 누르게 할 이유가 없다.
  useEffect(() => {
    void authenticate();
  }, [authenticate]);

  return (
    <SafeAreaView style={styles.overlay}>
      <View style={styles.body}>
        <Text style={styles.title}>잠겨 있습니다</Text>
        <Text style={styles.subtitle}>
          {message ?? '기기에 등록된 생체 정보로 잠금을 해제하세요.'}
        </Text>

        <Pressable style={styles.primaryButton} onPress={() => void authenticate()} disabled={isPrompting}>
          {isPrompting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>잠금 해제</Text>
          )}
        </Pressable>

        <Pressable style={styles.textButton} onPress={() => void signOut()}>
          <Text style={styles.textButtonLabel}>로그아웃</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    // 내비게이터 위를 통째로 덮는다. 배경을 불투명하게 채워야 뒤 내용이 비치지 않는다.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    zIndex: 10,
  },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.sm },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginBottom: spacing.md },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minWidth: 180,
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  textButton: { paddingVertical: spacing.md },
  textButtonLabel: { color: colors.textMuted, fontSize: 14 },
});
