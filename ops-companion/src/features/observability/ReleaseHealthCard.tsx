/**
 * S2 목록 화면 상단의 crash-free 요약 카드 (설계 §4.3 S2 · §6 Release Health).
 *
 * Phase 0 에서 "실데이터가 생길 때 추가"로 미뤄 둔 자리다. 이제 앱이 세션을 보내고 있어
 * 채울 수 있게 됐다.
 *
 * **왜 인시던트 건수와 따로 보여주나.** 목록의 건수는 "얼마나 많이 터졌나"이고, 이 카드는
 * "쓰는 사람이 얼마나 자주 겪었나"다. 에러 100건이 한 사람에게서 몰아서 나면 심각도가 낮고,
 * 1건이라도 열 때마다 죽으면 치명적이다. 온콜 담당자가 먼저 봐야 하는 것은 뒤쪽이다.
 *
 * 이 카드는 **보조 정보**다. 불러오지 못하면 조용히 사라지고 인시던트 목록은 그대로 보인다 —
 * 요약 때문에 본체를 못 보는 일이 없어야 한다.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useReleaseHealth } from './queries';
import type { ReleaseHealthItem } from '../../lib/api';
import { colors, spacing } from '../../theme';

/** 100%·99.87% 처럼 보여준다. 이 지표는 소수점 아래가 의미를 가진다(99.9 와 100 은 다른 이야기다). */
function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return rate >= 1 ? '100%' : `${(rate * 100).toFixed(2)}%`;
}

/** 업계 관례를 따른 눈대중 기준. 정확한 SLO 가 아니라 "한눈에 나쁜지"를 가리는 용도다. */
function rateColor(rate: number | null): string {
  if (rate === null) return colors.textMuted;
  if (rate >= 0.995) return colors.success;
  if (rate >= 0.98) return colors.warning;
  return colors.error;
}

/**
 * 릴리즈 이름에서 뒤쪽만 남긴다: `dev.ansmoon.opscompanion@1.0.0+1` → `1.0.0+1`.
 * 패키지명은 어차피 이 앱 하나라 화면에서 자리만 차지한다.
 */
function shortRelease(release: string): string {
  const at = release.lastIndexOf('@');
  return at === -1 ? release : release.slice(at + 1);
}

function PreviousRelease({ item }: { item: ReleaseHealthItem }) {
  return (
    <View style={styles.prevRow}>
      <Text style={styles.prevName} numberOfLines={1}>
        {shortRelease(item.release)}
      </Text>
      <Text style={[styles.prevRate, { color: rateColor(item.crashFreeRate) }]}>
        {formatRate(item.crashFreeRate)}
      </Text>
      <Text style={styles.prevSessions}>{item.sessions.toLocaleString()}세션</Text>
    </View>
  );
}

export function ReleaseHealthCard() {
  const { data, isError } = useReleaseHealth();

  // 로딩 중에도 자리를 비워 둔다. 스켈레톤을 넣으면 목록이 한 번 밀렸다가 제자리를 찾는다.
  if (isError || !data || data.releases.length === 0) return null;

  const [current, ...previous] = data.releases;

  return (
    <View style={styles.card}>
      <Text style={styles.label}>최근 {data.period} · 크래시 없이 끝난 세션</Text>

      <View style={styles.mainRow}>
        <Text style={[styles.rate, { color: rateColor(current.crashFreeRate) }]}>
          {formatRate(current.crashFreeRate)}
        </Text>
        <View style={styles.mainMeta}>
          <Text style={styles.release} numberOfLines={1}>
            {shortRelease(current.release)}
          </Text>
          <Text style={styles.sessions}>{current.sessions.toLocaleString()}세션</Text>
        </View>
      </View>

      {previous.length > 0 ? (
        <View style={styles.prevBlock}>
          {previous.map((item) => (
            <PreviousRelease key={item.release} item={item} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  label: { color: colors.textMuted, fontSize: 12 },
  mainRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.md },
  rate: { fontSize: 30, fontWeight: '700' },
  mainMeta: { flex: 1, gap: 2 },
  release: { color: colors.text, fontSize: 13, fontWeight: '600' },
  sessions: { color: colors.textMuted, fontSize: 12 },
  prevBlock: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  prevRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  prevName: { color: colors.textMuted, fontSize: 12, flex: 1 },
  prevRate: { fontSize: 12, fontWeight: '600' },
  prevSessions: { color: colors.textMuted, fontSize: 12, width: 72, textAlign: 'right' },
});
