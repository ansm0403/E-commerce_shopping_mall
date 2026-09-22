/**
 * S4. AnalysisScreen (설계 §4.3 S4) — "AI에게 원인 물어보기"의 도착지. 경로: /incidents/analysis/<id>
 *
 * 상세 화면([id].tsx)의 **형제** 경로로 둔다(`[id]/analysis.tsx` 로 하려면 상세를 `[id]/index.tsx` 로 옮겨야 하고,
 * 그러면 푸시 딥링크·학습 노트가 가리키는 파일 위치가 전부 바뀐다). 스택 위에 한 장 더 쌓이므로 뒤로 가기는 상세다.
 *
 * 상태 3가지(설계 §4.3 S4):
 *   로딩   — 스켈레톤. 첫 분석은 몇 초 걸린다(백엔드 → LLM 왕복, 스키마 위반 시 1회 재시도)
 *   성공   — AnalysisCard(구조화 카드)
 *   실패   — FallbackCard(원문 + 다시 분석). 백엔드가 두 번 시도해도 JSON 을 못 받은 경우다
 * 여기에 HTTP 에러(429 상한·409 분석 중·503 미설정·404)는 상세 화면과 같은 방식의 에러 화면으로 그린다.
 *
 * 데이터는 POST /v1/ops/incidents/:id/analysis 하나다. 처음 열면 생성, 다시 열면 백엔드가 저장된 행을 준다.
 *
 * Phase 8 후속(S4 보강): 채점 카드(S5)에만 있던 근거가 "고치는 사람"의 화면에 없었다. 같은 응답에 백엔드(컨트롤러)가 세 가지를 실어 준다 —
 *   운영 메모(사람이 조사해 확정한 원인·조치, 있을 때만 AI 답 **위**에) · 이름 대조 칩(AnalysisCard 의 추천 조치 아래) · 사람 채점 요약(아래).
 *   순서가 곧 읽는 순서다: 사람이 확정한 것 → AI 답(+ 그 조치의 이름이 실제 코드에 있는가) → 사람들이 그 답을 어떻게 봤나 → 내가 판정.
 */
import { useCallback } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AxiosError } from 'axios';
import { useAnalysis, useReanalyze } from '../../../../src/features/analysis/queries';
import { AnalysisCard, AnalysisMeta, CopyButton, FallbackCard, analysisToText } from '../../../../src/features/analysis/AnalysisCard';
import { ReviewSummaryCard } from '../../../../src/features/analysis/ReviewSummaryCard';
import { GuidancePanel } from '../../../../src/features/review/GuidancePanel';
import { colors, spacing } from '../../../../src/theme';

function errorMessage(error: unknown): { title: string; body: string; canRetry: boolean } {
  const status = (error as AxiosError)?.response?.status;
  if (status === 404) return { title: '찾을 수 없는 인시던트', body: '삭제됐거나 다른 이슈로 병합됐을 수 있습니다.', canRetry: false };
  if (status === 403) return { title: '권한 없음', body: '관리자 권한이 필요합니다.', canRetry: false };
  if (status === 503) return { title: 'AI 분석 미설정', body: '백엔드에 LLM API 키 또는 Sentry 연동이 설정되지 않았습니다.', canRetry: false };
  if (status === 429) return { title: '요청이 잠시 몰렸습니다', body: '무료 요금제의 분당 한도입니다. 1분 뒤 다시 시도해주세요.', canRetry: true };
  if (status === 409) return { title: '이미 분석 중입니다', body: '다른 곳에서 같은 인시던트를 분석하고 있습니다. 잠시 후 다시 열어주세요.', canRetry: true };
  if (status === 502) return { title: '불러오지 못했습니다', body: 'Sentry 조회에 실패했습니다. 잠시 후 다시 시도해주세요.', canRetry: true };
  return { title: '분석하지 못했습니다', body: '네트워크 상태를 확인해주세요. AI 응답이 늦어 시간이 초과됐을 수도 있습니다.', canRetry: true };
}

/** 로딩 자리 표시. 결과 카드와 같은 골격(뱃지 줄·원인·조치·파일)을 회색 덩어리로 그려 화면이 튀지 않게 한다 */
function Skeleton() {
  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <View style={[styles.bone, { width: 72, height: 20 }]} />
      </View>
      <View style={[styles.bone, styles.boneLabel]} />
      <View style={styles.card}>
        <View style={[styles.bone, { width: '95%' }]} />
        <View style={[styles.bone, { width: '80%' }]} />
        <View style={[styles.bone, { width: '60%' }]} />
      </View>
      <View style={[styles.bone, styles.boneLabel]} />
      <View style={styles.card}>
        <View style={[styles.bone, { width: '90%' }]} />
        <View style={[styles.bone, { width: '70%' }]} />
        <View style={[styles.bone, { width: '85%' }]} />
        <View style={[styles.bone, { width: '40%' }]} />
      </View>
      <Text style={styles.hint}>AI 가 스택트레이스와 직전 행동을 읽고 있습니다. 보통 5~15초 걸립니다.</Text>
    </View>
  );
}

export default function AnalysisScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, isPending, isError, error, refetch } = useAnalysis(id);
  const reanalyze = useReanalyze(id);

  const onReanalyze = useCallback(
    (simulate?: 'parse_failed') => {
      reanalyze.mutate(simulate ? { simulate } : undefined, {
        onError: (err) => {
          const message = errorMessage(err);
          Alert.alert(message.title, message.body);
        },
      });
    },
    [reanalyze],
  );

  if (isPending) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <Skeleton />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (isError) {
    const message = errorMessage(error);
    return (
      <SafeAreaView style={styles.centered} edges={['bottom']}>
        <Text style={styles.stateTitle}>{message.title}</Text>
        <Text style={styles.stateBody}>{message.body}</Text>
        {message.canRetry ? (
          <Pressable style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
        ) : null}
      </SafeAreaView>
    );
  }

  // 재분석 중에는 스켈레톤을 겹치지 않고 기존 결과를 그대로 두고 버튼만 잠근다 — 읽던 내용이 사라지면 안 된다.
  const isRetrying = reanalyze.isPending;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.metaRow}>
          <AnalysisMeta analysis={data} />
          {/* 분석 전체를 한 번에 — 다른 AI 에게 이중 검증을 시키거나 이슈에 붙일 때 */}
          {data.status === 'ok' ? <CopyButton text={analysisToText(data.result)} label="전체 복사" /> : null}
        </View>

        {/* 운영 메모 — 사람이 확정한 원인·조치. 있을 때만 그려지고(detail 모드), AI 답보다 위에 온다. 구조화 실패여도 메모는 유효하다 */}
        <GuidancePanel note={data.note ?? null} mode="detail" />

        {data.status === 'ok' ? (
          <>
            <AnalysisCard result={data.result} toolCalls={data.toolCalls} identifierCheck={data.identifierCheck} />
            {/* 이 답을 사람이 어떻게 봤나 — 반려가 있으면 조치를 그대로 쓰지 말라는 신호 */}
            <ReviewSummaryCard summary={data.reviewSummary} />
            {/* S4 → S5 (설계 §4.3 S4 마지막 줄). 평가 탭으로 넘어가며 이 분석 카드를 맨 앞으로 끌어올린다.
                순환 고리 ②→③ 의 손잡이 — 방금 읽은 분석이 맞는지 틀리는지를 사람이 바로 판정한다 */}
            <Pressable
              style={({ pressed }) => [styles.reviewButton, pressed && styles.disabled]}
              onPress={() => router.push({ pathname: '/review', params: { analysisId: String(data.id) } })}
            >
              <Text style={styles.reviewText}>이 분석 평가하기</Text>
              <Text style={styles.reviewHint}>승인한 분석은 다음 AI 분석의 예시가 됩니다</Text>
            </Pressable>
            <Pressable style={[styles.secondaryButton, isRetrying && styles.disabled]} onPress={() => onReanalyze()} disabled={isRetrying}>
              <Text style={styles.secondaryText}>{isRetrying ? '다시 분석 중…' : '다시 분석'}</Text>
            </Pressable>
          </>
        ) : (
          <FallbackCard rawText={data.rawText} onRetry={() => onReanalyze()} isRetrying={isRetrying} />
        )}

        {__DEV__ ? (
          // 개발 빌드 전용: 백엔드가 LLM 없이 구조화 실패 행을 만들게 해 fallback UI 를 실기기에서 확인한다(DoD "강제 실패 테스트").
          // 운영 백엔드는 이 옵션을 무시하므로 눌러도 실제 분석이 한 번 더 나갈 뿐이다 — 개발 빌드에서만 보인다.
          <Pressable style={[styles.devButton, isRetrying && styles.disabled]} onPress={() => onReanalyze('parse_failed')} disabled={isRetrying}>
            <Text style={styles.devText}>[DEV] 구조화 실패 시뮬레이션</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  stack: { gap: spacing.sm },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
  },
  bone: { height: 14, borderRadius: 6, backgroundColor: colors.border },
  boneLabel: { width: 56, height: 12, marginTop: spacing.sm, marginLeft: spacing.xs },
  hint: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: spacing.sm },
  stateTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
  stateBody: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  retryButton: {
    marginTop: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryText: { color: '#fff', fontWeight: '600' },
  reviewButton: {
    marginTop: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: 2,
  },
  reviewText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  reviewHint: { color: 'rgba(255,255,255,0.8)', fontSize: 12 },
  secondaryButton: {
    marginTop: spacing.sm,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  secondaryText: { color: colors.textMuted, fontSize: 14 },
  devButton: {
    marginTop: spacing.lg,
    borderColor: colors.warning,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  devText: { color: colors.warning, fontSize: 12 },
  disabled: { opacity: 0.6 },
});
