/**
 * S6. ProfileScreen (설계 §4.3 S6).
 * Phase 0 범위: 로그인한 계정 정보, 앱 버전, 로그아웃. 생체 인증 토글은 Phase 2.
 *
 * 로그아웃은 서버 세션까지 끊는다 — 앱은 쿠키가 없어서 refreshToken 을 body 로 보내야
 * 백엔드가 그 토큰을 무효화한다(안 그러면 7일간 살아 있다).
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../src/contexts/AuthContext';
import { API_BASE_URL, APP_VERSION } from '../../src/lib/config';
import { colors, spacing } from '../../src/theme';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await signOut();
      // 다음 로그인 사용자가 이전 사용자의 목록을 잠깐이라도 보지 않도록 캐시를 비운다.
      queryClient.clear();
    } catch {
      Alert.alert('로그아웃 실패', '잠시 후 다시 시도해주세요.');
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <View style={styles.card}>
        <Field label="계정" value={user?.email ?? '-'} />
        <Field label="닉네임" value={user?.nickName ?? '-'} />
        <Field label="권한" value={(user?.roles ?? []).join(', ') || '-'} />
      </View>

      <View style={styles.card}>
        <Field label="앱 버전" value={APP_VERSION} />
        <Field label="서버" value={API_BASE_URL} />
      </View>

      <Pressable style={styles.signOutButton} onPress={handleSignOut} disabled={isSigningOut}>
        {isSigningOut ? <ActivityIndicator color={colors.error} /> : <Text style={styles.signOutText}>로그아웃</Text>}
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.md, gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.md,
  },
  field: { gap: spacing.xs },
  fieldLabel: { color: colors.textMuted, fontSize: 12 },
  fieldValue: { color: colors.text, fontSize: 15 },
  signOutButton: {
    borderColor: colors.error,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  signOutText: { color: colors.error, fontSize: 15, fontWeight: '600' },
});
