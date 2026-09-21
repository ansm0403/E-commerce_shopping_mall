/**
 * S6. ProfileScreen (설계 §4.3 S6).
 * Phase 0 범위: 로그인한 계정 정보, 앱 버전, 로그아웃. 생체 인증 토글은 Phase 2.
 * Phase 1 추가: 푸시 등록 상태 — 알림이 안 올 때 "권한인지 개발 빌드인지"를 여기서 가린다.
 * Phase 2 추가: 생체 잠금 토글. 기기 안에서만 처리되며 서버·DB 와 무관하다(설계 §4.3 S1).
 *
 * 로그아웃은 서버 세션까지 끊는다 — 앱은 쿠키가 없어서 refreshToken 을 body 로 보내야
 * 백엔드가 그 토큰을 무효화한다(안 그러면 7일간 살아 있다).
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../src/contexts/AuthContext';
import { usePush } from '../../src/features/push/PushContext';
import { BiometricToggle } from '../../src/features/security/BiometricToggle';
import { describeRegistration } from '../../src/lib/notifications';
import { API_BASE_URL, APP_VERSION } from '../../src/lib/config';
import { isSentryActive, sendSentryTestError } from '../../src/lib/sentry';
import { colors, spacing } from '../../src/theme';

/**
 * `full` 을 주면 한 줄로 자르지 않고 전부 보여주며, 길게 눌러 복사할 수 있다.
 * 기기 토큰처럼 **옮겨 적어야 하는 값**에 쓴다 — 잘린 값은 없는 것과 같다.
 */
function Field({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} numberOfLines={full ? undefined : 1} selectable={full}>
        {value}
      </Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { registration, retry } = usePush();
  const queryClient = useQueryClient();
  const [isSigningOut, setIsSigningOut] = useState(false);

  function handleSentryTest() {
    const eventId = sendSentryTestError();
    Alert.alert(
      eventId ? '전송했습니다' : '전송하지 않았습니다',
      eventId
        ? `Sentry 이슈 목록에서 "Sentry 연결 테스트" 를 찾으세요.
이벤트 ID: ${eventId}`
        : 'DSN 이 비어 있거나 개발 모드입니다. .env 에 DSN 을 넣고 yarn start --no-dev --minify 로 실행하세요.',
    );
  }

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

  // ScrollView 로 감싼다 — Phase 1 에서 푸시 카드가 늘면서 내용이 화면보다 길어졌고,
  // 고정 레이아웃이라 아래쪽 로그아웃 버튼이 화면 밖으로 잘렸다(2026-09-20 실기기).
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Field label="계정" value={user?.email ?? '-'} />
        <Field label="닉네임" value={user?.nickName ?? '-'} />
        <Field label="권한" value={(user?.roles ?? []).join(', ') || '-'} />
      </View>

      <View style={styles.card}>
        <Field label="앱 버전" value={APP_VERSION} />
        <Field label="서버" value={API_BASE_URL} />
        <Field label="Sentry" value={isSentryActive() ? '켜짐' : '꺼짐 (DSN 없음 또는 개발 모드)'} />
      </View>

      <View style={styles.card}>
        <Field label="푸시 알림" value={describeRegistration(registration)} />
        {registration?.status === 'registered' ? (
          <Field label="기기 토큰" value={registration.token} full />
        ) : null}
      </View>

      <BiometricToggle />

      {registration !== null && registration.status !== 'registered' ? (
        <Pressable style={styles.secondaryButton} onPress={() => void retry()}>
          <Text style={styles.secondaryText}>푸시 등록 다시 시도</Text>
        </Pressable>
      ) : null}

      <Pressable style={styles.secondaryButton} onPress={handleSentryTest}>
        <Text style={styles.secondaryText}>Sentry 테스트 에러 보내기</Text>
      </Pressable>

      <Pressable style={styles.signOutButton} onPress={handleSignOut} disabled={isSigningOut}>
        {isSigningOut ? <ActivityIndicator color={colors.error} /> : <Text style={styles.signOutText}>로그아웃</Text>}
      </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md },
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
  secondaryButton: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  secondaryText: { color: colors.textMuted, fontSize: 14 },
  signOutButton: {
    borderColor: colors.error,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  signOutText: { color: colors.error, fontSize: 15, fontWeight: '600' },
});
