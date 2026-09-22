/**
 * 데모 계정(포트폴리오 방문자) 배너 — 탭 화면 전체 위에 한 줄.
 *
 * "이 앱이 무엇인지"는 로그인 화면이 말했고, 여기서는 **지금 보는 것이 무엇인지**만 말한다:
 * 실제 운영 Sentry 데이터(최근 14일)이고, 무엇이 되고 무엇이 꺼져 있는지. 서버가 토큰의 isDemo 로 같은 규칙을 적용하므로
 * 이 배너는 안내일 뿐 권한을 정하지 않는다(설계 §7 — 권한은 항상 백엔드).
 */
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { colors, spacing } from '../../theme';

/** 데모 계정의 인시던트 목록 기간. 백엔드 OpsService.DEMO_STATS_PERIOD(14d)와 같다 — 응답 헤더 X-Period 가 진실이지만 표시용으로 고정 */
export const DEMO_PERIOD_LABEL = '최근 14일';

export function useIsDemo(): boolean {
  const { user } = useAuth();
  return user?.isDemo === true;
}

export function DemoBanner() {
  const isDemo = useIsDemo();
  if (!isDemo) return null;
  return (
    <View style={styles.banner} accessibilityRole="text">
      <Text style={styles.text}>
        데모 계정 · 실제 운영 데이터({DEMO_PERIOD_LABEL}) · 조회·AI 분석·채점 가능 / 푸시·메모·재분석 꺼짐
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.accent,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  text: { color: colors.accent, fontSize: 12, textAlign: 'center' },
});
