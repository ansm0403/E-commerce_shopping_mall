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
} as const;

export const levelColor: Record<'error' | 'warning' | 'info', string> = {
  error: colors.error,
  warning: colors.warning,
  info: colors.info,
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24 } as const;
