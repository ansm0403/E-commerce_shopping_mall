/** 화면 공용 색/간격. 화면 수가 적어 디자인 시스템 대신 상수 한 벌로 둔다. */
export const colors = {
  background: '#0f1115',
  surface: '#191d24',
  border: '#272d38',
  text: '#e8eaed',
  textMuted: '#9aa3b2',
  accent: '#4c8dff',
  error: '#ff6b6b',
  warning: '#ffb020',
  info: '#4cc4ff',
  /** Release Health 카드의 '건강함' 표시. 지표가 좋을 때만 쓴다 */
  success: '#3fb950',
} as const;

export const levelColor: Record<'error' | 'warning' | 'info', string> = {
  error: colors.error,
  warning: colors.warning,
  info: colors.info,
};

/** AI 분석의 심각도 4단계(설계 §5.4). 인시던트 레벨 3색과 별개 축이라 따로 둔다 — critical 은 보라색으로 구분 */
export const severityColor: Record<'critical' | 'high' | 'medium' | 'low', string> = {
  critical: '#c678dd',
  high: colors.error,
  medium: colors.warning,
  low: colors.info,
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24 } as const;
