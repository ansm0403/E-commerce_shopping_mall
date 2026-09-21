/**
 * 프로필의 "생체 잠금" 토글 (설계 §4.3 S6 · S1).
 *
 * 켤 때만 인증을 요구한다. 증명 없이 켜면 "내 지문으로 잠갔다"가 성립하지 않기 때문이다.
 * 끌 때는 요구하지 않는다 — 이 화면에 닿았다는 것 자체가 이미 잠금을 통과했다는 뜻이다.
 *
 * 쓸 수 없는 기기에서는 토글 대신 **이유**를 보여준다. 눌러도 아무 일이 없는 스위치보다
 * "기기에 지문이 등록돼 있지 않습니다" 한 줄이 사용자를 실제로 움직이게 한다.
 * 푸시 등록 상태를 이유별로 나눠 보여주는 것과 같은 방침이다(lib/notifications.ts).
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import {
  getBiometricCapability,
  isBiometricLockEnabled,
  promptBiometric,
  setBiometricLockEnabled,
  type BiometricCapability,
} from '../../lib/biometrics';
import { colors, spacing } from '../../theme';

function describe(capability: BiometricCapability): string {
  switch (capability.status) {
    case 'no-hardware':
      return '이 기기는 생체 인증을 지원하지 않습니다.';
    case 'not-enrolled':
      return '기기 설정에서 지문 또는 얼굴을 먼저 등록해주세요.';
    case 'ready':
      return `${capability.label}으로 앱을 잠급니다. 기기 안에서만 확인하며 서버로 전송되지 않습니다.`;
  }
}

export function BiometricToggle() {
  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getBiometricCapability(), isBiometricLockEnabled()]).then(([cap, on]) => {
      if (cancelled) return;
      setCapability(cap);
      setEnabled(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onToggle = useCallback(
    async (next: boolean) => {
      if (isBusy) return;
      setIsBusy(true);
      try {
        if (next) {
          const result = await promptBiometric('생체 잠금을 켜려면 본인 확인이 필요합니다');
          if (!result.success) {
            // 사용자가 스스로 닫은 경우는 조용히 되돌린다. 실패 경고를 띄울 일이 아니다.
            if (result.error !== 'user_cancel') {
              Alert.alert('켜지 못했습니다', '본인 확인에 실패했습니다.');
            }
            return;
          }
        }
        await setBiometricLockEnabled(next);
        setEnabled(next);
      } catch {
        Alert.alert('설정하지 못했습니다', '잠시 후 다시 시도해주세요.');
      } finally {
        setIsBusy(false);
      }
    },
    [isBusy],
  );

  if (capability === null) return null;

  const isReady = capability.status === 'ready';

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.label}>생체 잠금</Text>
        {isReady ? (
          <Switch
            value={enabled}
            onValueChange={(next) => void onToggle(next)}
            disabled={isBusy}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor="#fff"
          />
        ) : (
          <Text style={styles.unavailable}>사용 불가</Text>
        )}
      </View>
      <Text style={styles.help}>{describe(capability)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: colors.text, fontSize: 15 },
  unavailable: { color: colors.textMuted, fontSize: 13 },
  help: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
});
