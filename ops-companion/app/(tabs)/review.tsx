/**
 * S5. ReviewScreen (설계 §4.3 S5) — AI 분석을 사람이 채점하는 카드 스택. 하단 탭 2.
 *
 * 흐름: GET /ops/analyses/pending 으로 "내가 아직 채점하지 않은 분석"을 받아 한 장씩 보여준다.
 *   오른쪽 스와이프 = 승인 · 왼쪽 = 반려 (또는 아래 버튼). 별점은 선택.
 *   스와이프 순간 카드가 목록에서 빠지고(낙관적 업데이트, queries.ts) POST /ops/analyses/:id/review 가 뒤에서 나간다.
 *   실패하면 카드가 맨 앞으로 되돌아오고 토스트가 뜬다.
 *
 * 블라인드: 카드에는 프롬프트 버전이 없다 — 백엔드가 응답에서 뺐다(설계 §9 Phase 4 결정 ①). 채점이 끝나야
 * 집계(GET /ops/analyses/stats)에서 v1·v2 가 갈린다.
 *
 * 진입 경로 둘: 탭을 직접 누르거나, S4 분석 화면의 "이 분석 평가하기" → `/review?analysisId=…` 로 온다.
 * 후자는 그 카드를 맨 앞으로 끌어올린다(이미 채점한 분석이면 목록에 없으므로 알려만 준다).
 *
 * 순환 고리(설계 §1.4)의 ③ 이 화면이고, 여기서 승인된 분석이 ④ 다음 프롬프트의 few-shot 예시가 된다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AxiosError } from 'axios';
import { usePendingReviews, useSubmitReview } from '../../src/features/review/queries';
import { SwipeCard, type SwipeCardHandle } from '../../src/features/review/SwipeCard';
import { StarRating } from '../../src/features/review/StarRating';
import { AnalysisCard } from '../../src/features/analysis/AnalysisCard';
import type { PendingReview, ReviewVerdict } from '../../src/lib/api';
import { timeAgo } from '../../src/lib/format';
import { colors, spacing } from '../../src/theme';

/** 카드 본문 — 인시던트 한 줄 + 분석 카드. AnalysisCard 는 S4 와 같은 컴포넌트라 방어 렌더링도 그대로다 */
function ReviewCardBody({ item }: { item: PendingReview }) {
  return (
    <ScrollView style={styles.cardScroll} contentContainerStyle={styles.cardContent} nestedScrollEnabled>
      <Text style={styles.incidentTitle} numberOfLines={3}>
        {item.incidentTitle ?? `인시던트 #${item.incidentId}`}
      </Text>
      {item.exceptionText ? (
        <Text style={styles.exception} numberOfLines={2}>
          {item.exceptionText}
        </Text>
      ) : null}
      <Text style={styles.meta}>
        {[item.model ?? '모델 미상', `분석 ${timeAgo(item.createdAt)}`].join(' · ')}
      </Text>
      <AnalysisCard result={item.result} />
    </ScrollView>
  );
}

/** 화면 아래 잠깐 뜨는 알림. RN 에 크로스플랫폼 toast 가 없어 직접 그린다 */
function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View pointerEvents="none" style={styles.toast}>
      <Text style={styles.toastText}>{message}</Text>
    </View>
  );
}

export default function ReviewScreen() {
  const { analysisId: focusParam } = useLocalSearchParams<{ analysisId?: string }>();
  const router = useRouter();
  const { data, isPending, isError, error, refetch, isRefetching } = usePendingReviews();
  const submit = useSubmitReview();

  const cardRef = useRef<SwipeCardHandle>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2_500);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // S4 에서 "이 분석 평가하기"로 왔으면 그 카드를 맨 앞으로. 목록에 없으면(이미 채점) 알려 준다
  const focusId = focusParam ? Number(focusParam) : null;
  const cards = useMemo(() => {
    if (!data) return [];
    if (focusId === null) return data;
    const idx = data.findIndex((p) => p.analysisId === focusId);
    if (idx <= 0) return data;
    return [data[idx], ...data.slice(0, idx), ...data.slice(idx + 1)];
  }, [data, focusId]);
  const focusMissingNotified = useRef(false);
  useEffect(() => {
    if (focusId === null || !data || focusMissingNotified.current) return;
    if (!data.some((p) => p.analysisId === focusId)) {
      focusMissingNotified.current = true;
      showToast('이미 평가한 분석입니다');
    }
  }, [data, focusId, showToast]);

  const top = cards[0];
  const next = cards[1];
  const total = reviewedCount + cards.length;

  const onSwipe = useCallback(
    (verdict: ReviewVerdict) => {
      if (!top) return;
      const card = top;
      const chosen = rating;
      setRating(null);
      setReviewedCount((n) => n + 1);
      submit.mutate(
        { analysisId: card.analysisId, verdict, ...(chosen !== null ? { rating: chosen } : {}) },
        {
          onError: (err) => {
            setReviewedCount((n) => Math.max(0, n - 1));
            const status = (err as AxiosError)?.response?.status;
            showToast(status === 400 ? '평가할 수 없는 분석입니다(구조화 실패 행)' : '저장하지 못했습니다. 카드를 되돌렸습니다');
          },
        },
      );
    },
    [top, rating, submit, showToast],
  );

  if (isPending) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom']}>
        <ActivityIndicator color={colors.accent} size="large" />
      </SafeAreaView>
    );
  }

  if (isError) {
    const status = (error as AxiosError)?.response?.status;
    return (
      <SafeAreaView style={styles.centered} edges={['bottom']}>
        <Text style={styles.stateTitle}>{status === 403 ? '권한 없음' : '불러오지 못했습니다'}</Text>
        <Text style={styles.stateBody}>{status === 403 ? '관리자 권한이 필요합니다.' : '네트워크 상태를 확인해주세요.'}</Text>
        {status !== 403 ? (
          <Pressable style={styles.primaryButton} onPress={() => refetch()}>
            <Text style={styles.primaryText}>다시 시도</Text>
          </Pressable>
        ) : null}
      </SafeAreaView>
    );
  }

  if (!top) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom']}>
        <Text style={styles.stateTitle}>{reviewedCount > 0 ? '모두 평가했습니다' : '평가할 분석이 없습니다'}</Text>
        <Text style={styles.stateBody}>
          {reviewedCount > 0
            ? `이번에 ${reviewedCount}건을 채점했습니다. 승인한 분석은 다음 AI 분석의 예시가 됩니다.`
            : '인시던트 상세 → "AI에게 원인 물어보기"로 분석을 만들면 여기에 쌓입니다.'}
        </Text>
        <Pressable style={[styles.primaryButton, isRefetching && styles.disabled]} onPress={() => refetch()} disabled={isRefetching}>
          <Text style={styles.primaryText}>{isRefetching ? '확인 중…' : '새로 확인'}</Text>
        </Pressable>
        <Pressable style={styles.linkButton} onPress={() => router.push('/incidents')}>
          <Text style={styles.linkText}>인시던트 목록으로</Text>
        </Pressable>
        <Toast message={toast} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <View style={styles.header}>
        <Text style={styles.progress}>
          {reviewedCount + 1} / {total}
        </Text>
        <Text style={styles.hint}>오른쪽으로 밀면 승인, 왼쪽은 반려 · 프롬프트 버전은 채점 중 표시하지 않습니다</Text>
      </View>

      <View style={styles.deck}>
        {/* 다음 카드가 뒤에 살짝 보인다 — 한 장 넘기면 "그다음"이 있다는 신호 */}
        {next ? (
          <View style={[styles.card, styles.nextCard]} pointerEvents="none">
            <Text style={styles.nextTitle} numberOfLines={1}>
              {next.incidentTitle ?? `인시던트 #${next.incidentId}`}
            </Text>
          </View>
        ) : null}
        {/* key 가 analysisId 라 카드가 바뀌면 새로 마운트된다 — translateX 가 0 에서 시작한다 */}
        <SwipeCard key={top.analysisId} ref={cardRef} onSwipe={onSwipe}>
          <ReviewCardBody item={top} />
        </SwipeCard>
      </View>

      <View style={styles.controls}>
        <Pressable
          style={({ pressed }) => [styles.verdictButton, styles.rejectButton, pressed && styles.pressed]}
          onPress={() => cardRef.current?.swipe('rejected')}
          accessibilityLabel="반려"
        >
          <Text style={[styles.verdictText, { color: colors.error }]}>✕ 반려</Text>
        </Pressable>
        <StarRating value={rating} onChange={setRating} />
        <Pressable
          style={({ pressed }) => [styles.verdictButton, styles.approveButton, pressed && styles.pressed]}
          onPress={() => cardRef.current?.swipe('approved')}
          accessibilityLabel="승인"
        >
          <Text style={[styles.verdictText, { color: colors.success }]}>승인 ✓</Text>
        </Pressable>
      </View>

      <Toast message={toast} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: 2 },
  progress: { color: colors.text, fontSize: 16, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: 11 },
  deck: { flex: 1, margin: spacing.md, marginBottom: spacing.sm },
  card: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
  },
  nextCard: { transform: [{ scale: 0.96 }, { translateY: 10 }], opacity: 0.7, padding: spacing.md },
  nextTitle: { color: colors.textMuted, fontSize: 14 },
  cardScroll: { flex: 1 },
  cardContent: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.lg },
  incidentTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  exception: { color: colors.textMuted, fontSize: 12, fontFamily: 'monospace' },
  meta: { color: colors.textMuted, fontSize: 11, marginBottom: spacing.xs },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  verdictButton: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  rejectButton: { borderColor: colors.error },
  approveButton: { borderColor: colors.success },
  verdictText: { fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  stateTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
  stateBody: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  primaryButton: {
    marginTop: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  primaryText: { color: '#fff', fontWeight: '600' },
  linkButton: { paddingVertical: spacing.sm },
  linkText: { color: colors.textMuted, fontSize: 13, textDecorationLine: 'underline' },
  disabled: { opacity: 0.6 },
  toast: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: 72,
    backgroundColor: '#2a2f3a',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  toastText: { color: colors.text, fontSize: 13 },
});
