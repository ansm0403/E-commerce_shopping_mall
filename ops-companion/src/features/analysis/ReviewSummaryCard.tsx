/**
 * 사람 채점 요약(Phase 8 후속) — S4 에서 "이 AI 답을 사람이 어떻게 봤나"를 한 줄로.
 * 승인/반려 수 · 평균 별점 · 내 판정. 채점이 없으면 "아직 채점되지 않았습니다"(아래 "이 분석 평가하기" 버튼이 다음 행동이다).
 * S5(채점 카드)에는 그리지 않는다 — 채점 중에 남의 판정이 보이면 블라인드의 취지가 흔들린다(백엔드도 대기 응답에 싣지 않는다).
 */
import { StyleSheet, Text, View } from 'react-native';
import type { ReviewSummary } from '../../lib/api';
import { colors, spacing } from '../../theme';

const VERDICT_LABEL = { approved: '승인', rejected: '반려' } as const;

const formatMine = (mine: NonNullable<ReviewSummary['mine']>) =>
  `내 판정: ${VERDICT_LABEL[mine.verdict] ?? mine.verdict}${mine.rating !== null ? ` · 별점 ${mine.rating}` : ''}${mine.guided ? ' (안내 채점)' : ''}`;

export function ReviewSummaryCard({ summary }: { summary: ReviewSummary | null | undefined }) {
  if (summary === undefined) return null;
  if (!summary || (summary.reviews === 0 && !summary.mine)) {
    return (
      <View style={styles.panel}>
        <Text style={styles.title}>사람 채점 · 아직 없음</Text>
        <Text style={styles.hint}>이 답이 맞는지 아직 아무도 판정하지 않았습니다. 아래 "이 분석 평가하기"로 첫 판정을 남길 수 있습니다.</Text>
      </View>
    );
  }
  if (summary.reviews === 0 && summary.mine) {
    // 집계(reviews)는 데모 계정의 채점을 빼지만 `mine` 은 요청자 자신의 판정이라 데모여도 온다(OpsReviewService.summarizeReviews).
    // 웹 → 앱 연동 확인(설계 §9)의 마지막 고리 — 방문자가 방금 채점한 새 인시던트에서 자기 판정이 보여야 한다.
    return (
      <View style={styles.panel}>
        <Text style={styles.title}>사람 채점 · 아직 없음 — {formatMine(summary.mine)}</Text>
        <Text style={styles.hint}>내 판정은 저장됐지만 데모 계정의 채점은 집계에 들어가지 않습니다. 다른 사람의 판정이 쌓이면 여기에 승인/반려 수가 보입니다.</Text>
      </View>
    );
  }
  const parts = [`승인 ${summary.approved}`, `반려 ${summary.rejected}`];
  if (summary.avgRating !== null) parts.push(`별점 ${summary.avgRating.toFixed(1)}`);
  const mine = summary.mine ? formatMine(summary.mine) : null;
  const tone = summary.rejected > summary.approved ? colors.error : summary.approved > 0 ? colors.success : colors.textMuted;

  return (
    <View style={[styles.panel, { borderColor: tone }]}>
      <Text style={styles.title}>
        사람 채점 · {summary.reviews}건 — <Text style={{ color: tone }}>{parts.join(' · ')}</Text>
      </Text>
      {mine ? <Text style={styles.mine}>{mine}</Text> : null}
      <Text style={styles.hint}>반려가 있으면 조치를 그대로 쓰지 말고 채점 카드의 메모·확인 항목을 먼저 보세요.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.xs,
  },
  title: { color: colors.text, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  mine: { color: colors.text, fontSize: 12 },
  hint: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
});
