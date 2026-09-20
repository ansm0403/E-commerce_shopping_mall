/**
 * 앱의 입구(경로 `/`) — 로그인 여부에 따라 첫 화면으로 보낸다.
 *
 * 왜 이 파일이 필요한가. 앱을 켤 때 Expo Router 가 받는 초기 경로가 실행 환경마다 다르다.
 *
 *   Expo Go      : `exp://192.168.0.5:8081`      → 경로 **빈 문자열** → 루트 레이아웃의 첫 화면으로 간다
 *   개발 빌드    : `opscompanion://expo-development-client/?url=http://192.168.0.5:8081`
 *                  → 안쪽 url 을 다시 풀어 경로 **`/`** 가 된다
 *                  (expo-router/build/fork/extractPathFromURL.js — isExpoDevelopmentClient 분기)
 *
 * `/` 는 "루트의 index 화면"을 뜻하므로 그 파일이 없으면 **Unmatched Route** 가 뜬다.
 * Phase 0 을 Expo Go 로만 확인했을 때는 경로가 빈 문자열이어서 드러나지 않았다(2026-09-20 실기기).
 *
 * 이 화면은 그려지지 않는다 — 판단만 하고 곧바로 넘긴다. `Stack.Protected` 가 라우트를 가리므로
 * 미로그인 상태에서 `/incidents` 로 보내면 다시 갈 곳이 없어지고, 그래서 여기서 갈라준다.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/contexts/AuthContext';
import { colors } from '../src/theme';

export default function Index() {
  const { user, isBooting } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // 토큰 복원이 끝나기 전에 보내면 로그인 화면이 한 번 번쩍인다.
    if (isBooting) return;
    // replace 다 — push 면 이 갈림길이 스택에 남아 뒤로 가기가 빈 화면으로 온다.
    router.replace(user ? '/incidents' : '/login');
  }, [isBooting, user, router]);

  // 이동 전 한 프레임 동안 보이는 배경. 비워 두면(null) 흰 화면이 번쩍인다.
  return <View style={styles.screen} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
});
