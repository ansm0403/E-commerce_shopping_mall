/**
 * S1. LoginScreen (설계 §4.3 S1).
 *
 * POST /v1/auth/login → accessToken·refreshToken 을 SecureStore 에 저장 → AuthContext.user 세팅.
 * 그 순간 루트 레이아웃의 렌더 분기가 탭 화면으로 바뀐다(이동 명령 없음).
 *
 * ⚠ 로그인은 IP 당 10회/5분 제한이 있다. 앱은 nginx 기준 1홉이라 진짜 IP 로 기록되므로
 * 비밀번호를 반복해 틀리면 본인 IP 가 5분 잠긴다(설계 §11).
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AxiosError } from 'axios';
import { useAuth } from '../../src/contexts/AuthContext';
import { colors, spacing } from '../../src/theme';

function messageOf(error: unknown): string {
  const status = (error as AxiosError)?.response?.status;
  const serverMessage = ((error as AxiosError)?.response?.data as { message?: string } | undefined)?.message;

  if (status === 401) return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (status === 429) return '로그인 시도가 많습니다. 5분 뒤에 다시 시도해주세요.';
  if (serverMessage) return serverMessage;
  return '로그인에 실패했습니다. 네트워크 상태를 확인해주세요.';
}

/** 데모 로그인은 비밀번호가 없어 401 이 아니라 403(서버가 데모를 껐다)이 온다 — 문구를 따로 둔다 */
function demoMessageOf(error: unknown): string {
  const status = (error as AxiosError)?.response?.status;
  if (status === 403) return '데모 로그인이 지금은 꺼져 있습니다.';
  if (status === 429) return '로그인 시도가 많습니다. 5분 뒤에 다시 시도해주세요.';
  return messageOf(error);
}

export default function LoginScreen() {
  const { signIn, signInDemo } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDemoSubmitting, setIsDemoSubmitting] = useState(false);

  const busy = isSubmitting || isDemoSubmitting;
  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  // 포트폴리오 방문자 경로 — 계정 정보를 앱에 넣지 않는다. 서버가 DEMO_LOGIN_ENABLED 로 켜고 끈다(웹 로그인 화면의 버튼과 같은 API).
  async function handleDemo() {
    if (busy) return;
    setError(null);
    setIsDemoSubmitting(true);
    try {
      await signInDemo();
    } catch (err) {
      setError(demoMessageOf(err));
    } finally {
      setIsDemoSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={styles.title}>Ops Companion</Text>
        <Text style={styles.tagline}>
          쇼핑몰 운영자용 온콜 앱 — Sentry 장애를 보고, AI 가 소스 코드를 읽어 원인을 분석하고, 사람이 그 답을 채점합니다.
        </Text>
        <Text style={styles.subtitle}>관리자 계정으로 로그인하세요.</Text>

        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="이메일"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          editable={!isSubmitting}
        />
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="비밀번호"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          textContentType="password"
          editable={!isSubmitting}
          onSubmitEditing={handleSubmit}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>로그인</Text>
          )}
        </Pressable>

        <Pressable
          style={[styles.demoButton, busy && styles.buttonDisabled]}
          onPress={handleDemo}
          disabled={busy}
          accessibilityRole="button"
        >
          {isDemoSubmitting ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Text style={styles.demoButtonText}>데모 계정으로 체험하기</Text>
          )}
        </Pressable>

        <View style={styles.hintBox}>
          <Text style={styles.hint}>
            관리자 권한이 있는 계정만 인시던트를 볼 수 있습니다.{'\n'}
            데모 계정은 실제 운영 데이터를 조회·분석·채점할 수 있고, 푸시·메모 저장·재분석은 꺼져 있습니다.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg, gap: spacing.sm },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  tagline: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  subtitle: { color: colors.textMuted, fontSize: 14, marginBottom: spacing.md },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
  },
  error: { color: colors.error, fontSize: 13, marginTop: spacing.xs },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  demoButton: {
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  demoButtonText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  hintBox: { marginTop: spacing.lg },
  hint: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
});
