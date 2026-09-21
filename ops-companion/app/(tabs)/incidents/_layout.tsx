/**
 * 인시던트 탭 안의 스택 (설계 §4.1 IncidentsStack): 목록(index) → 상세([id]) → AI 분석(analysis/[id]).
 *
 * 탭은 "옆으로 나란한 화면", 스택은 "위로 쌓이는 화면"이다. 목록에서 한 건을 누르면 상세가
 * 목록 **위에** 쌓이고, 뒤로 가기는 맨 위 화면을 걷어낸다. 그래서 탭 안에 스택을 하나 더 둔다.
 *
 * `anchor: 'index'` — 이 스택의 바닥은 항상 목록이라는 선언이다.
 * 푸시 알림이나 딥링크(`opscompanion://incidents/123`)로 상세에 **바로** 들어오면 스택에 상세 한 장만
 * 있어서 뒤로 가기가 앱을 닫아 버린다. anchor 를 주면 Expo Router 가 목록을 밑에 깔아 준다
 * (expo-router/build/getRoutesCore.js — unstable_settings.anchor).
 */
import { Stack } from 'expo-router';
import { colors } from '../../../src/theme';

export const unstable_settings = { anchor: 'index' };

export default function IncidentsStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: '인시던트' }} />
      <Stack.Screen name="[id]" options={{ title: '인시던트 상세' }} />
      <Stack.Screen name="analysis/[id]" options={{ title: 'AI 분석' }} />
    </Stack>
  );
}
