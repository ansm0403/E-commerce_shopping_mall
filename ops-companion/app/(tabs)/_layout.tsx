/**
 * 하단 탭 (설계 §4.1 AppTabs).
 * Phase 0 은 인시던트·프로필 두 개였고, Phase 4 에서 평가 탭(Tab 2)이 들어왔다 —
 * 빈 탭을 미리 만들어 두지 않는 것이 "각 Phase 는 그 자체로 완결된 데모" 원칙에 맞다.
 */
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '../../src/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        // 폴더 이름 = incidents/_layout.tsx 의 스택. 헤더는 그 스택이 그리므로(상세의 뒤로 가기 버튼)
        // 탭 헤더는 끈다 — 안 끄면 헤더가 두 줄로 겹친다.
        name="incidents"
        options={{
          title: '인시던트',
          headerShown: false,
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>⚠</Text>,
        }}
      />
      <Tabs.Screen
        // S5 평가 카드 스택(Phase 4). 스택이 아니라 화면 하나라 탭 헤더를 그대로 쓴다
        name="review"
        options={{
          title: '평가',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>☑</Text>,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '프로필',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>👤</Text>,
        }}
      />
    </Tabs>
  );
}
