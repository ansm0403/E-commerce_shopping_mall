/**
 * 루트 레이아웃 — 앱 전체를 감싸는 껍데기 (설계 §4.1 RootNavigator).
 *
 * Expo Router 는 `app/` 아래 **파일 경로가 곧 화면 경로**가 되는 파일 기반 내비게이션이다.
 * `_layout.tsx` 는 그 폴더의 공통 껍데기이고, 여기 있는 Provider 들이 모든 화면을 감싼다.
 *
 * 로그인 분기는 화면 이동 명령이 아니라 **렌더 분기**다(설계 §4.1):
 * user 가 없으면 (auth) 만, 있으면 (tabs) 만 라우트로 남긴다. 남지 않은 경로는
 * 아예 존재하지 않으므로, 로그아웃 직후 이전 화면이 남는 상태가 생기지 않는다.
 *
 * ⚠ 이 분기는 반드시 `Stack.Protected guard` 로 해야 한다. Expo Router 는 app/ 폴더의 파일을
 * 기준으로 라우트를 **전부** 등록하고, 자식 `<Stack.Screen>` 은 옵션·순서만 정한다.
 * 그래서 `{user ? <Screen a/> : <Screen b/>}` 처럼 그리지 않는 것만으로는 라우트가 사라지지 않아
 * 로그인에 성공해도 로그인 화면에 그대로 머문다(expo-router/build/useScreens.js useSortedScreens —
 * guard=false 인 Screen 만 protectedScreens 로 걸러진다).
 */
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { PushProvider } from '../src/features/push/PushContext';
import { usePushRouting } from '../src/features/push/usePushRouting';
import { useScreenTag } from '../src/features/observability/useScreenTag';
import { BiometricLockProvider, useBiometricLock } from '../src/features/security/BiometricLockContext';
import { LockScreen } from '../src/features/security/LockScreen';
import { initSentry } from '../src/lib/sentry';
import { colors } from '../src/theme';

initSentry();

/**
 * 앱을 보고 있는 동안 알림이 오면 어떻게 할지(설계 §4.2 ① 포그라운드).
 * 기본값은 "아무것도 안 함" 이라 배너가 뜨지 않는다 — 온콜 앱에서는 보여야 한다.
 * banner = 화면 위 배너, list = 알림 센터 목록.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// staleTime 기본 5분(설계 §5.5). 목록 쿼리는 자기 쪽에서 1분으로 좁힌다.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60_000, refetchOnWindowFocus: false } },
});

function RootNavigator() {
  const { user, isBooting } = useAuth();
  // 알림 탭 → 상세 화면. 3상태(포그라운드/백그라운드/종료)를 이 훅이 전부 처리한다.
  usePushRouting();
  // 현재 화면을 Sentry 태그로. 에러를 화면별로 모아 볼 수 있게 한다(설계 §6).
  useScreenTag();
  const { isLocked } = useBiometricLock();

  if (isBooting) {
    // SecureStore 복원 + /auth/me 검증이 끝나기 전. 이 시간이 없으면 로그인 상태인데도
    // 로그인 화면이 한 번 번쩍이고 지나간다.
    return (
      <View style={styles.booting}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  // 잠금은 라우트가 아니라 **덮개**다. Stack 을 그대로 두고 그 위에 겹쳐야, 잠긴 동안에도
  // 뒤에서 딥링크 이동이 일어나고 해제하는 순간 목적지 화면이 이미 떠 있다.
  return (
    <View style={styles.root}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Protected guard={user !== null}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={user === null}>
          <Stack.Screen name="(auth)/login" />
        </Stack.Protected>
      </Stack>
      {isLocked ? <LockScreen /> : null}
    </View>
  );
}

export default function RootLayout() {
  useEffect(() => {
    // 다크 배경 고정 — 운영 화면은 야간에 보는 일이 많다.
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BiometricLockProvider>
          <PushProvider>
            <StatusBar style="light" />
            <RootNavigator />
          </PushProvider>
          </BiometricLockProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  booting: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
