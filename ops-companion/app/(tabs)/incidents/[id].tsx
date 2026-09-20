/**
 * S3. IncidentDetailScreen (설계 §4.3 S3) — 푸시 알림·딥링크의 도착지.
 *
 * 파일 이름의 대괄호 `[id]` 는 "이 자리는 값이 들어오는 칸"이라는 뜻이다(Next.js 의 동적 라우트와 같다).
 * `/incidents/7742806116` 으로 들어오면 useLocalSearchParams() 가 `{ id: '7742806116' }` 을 준다.
 *
 * 데이터는 GET /v1/ops/incidents/:id — 백엔드가 Sentry 의 issue + 최신 event 를 합쳐
 * 예외·스택(최근 호출이 앞)·breadcrumbs 만 남겨 준다. request 헤더·쿠키·사용자 IP 는 오지 않는다.
 *
 * "AI에게 원인 물어보기" 버튼은 Phase 3 에서 붙인다(그 전에는 숨김 — 설계 §4.3 S3).
 */
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { AxiosError } from 'axios';
import { useIncident } from '../../../src/features/incidents/queries';
import type { IncidentBreadcrumb, IncidentStackFrame } from '../../../src/lib/api';
import { clockTime, timeAgo } from '../../../src/lib/format';
import { colors, levelColor, spacing } from '../../../src/theme';

function errorMessage(error: unknown): { title: string; body: string; canRetry: boolean } {
  const status = (error as AxiosError)?.response?.status;
  if (status === 404) {
    // 오래된 푸시를 눌렀는데 그 사이 Sentry 에서 이슈가 지워졌거나 병합된 경우.
    return { title: '찾을 수 없는 인시던트', body: '삭제됐거나 다른 이슈로 병합됐을 수 있습니다.', canRetry: false };
  }
  if (status === 403) return { title: '권한 없음', body: '관리자 권한이 필요합니다.', canRetry: false };
  if (status === 503) return { title: '연동 미설정', body: '백엔드에 Sentry 연동이 설정되지 않았습니다.', canRetry: false };
  if (status === 502) return { title: '불러오지 못했습니다', body: 'Sentry 조회에 실패했습니다. 잠시 후 다시 시도해주세요.', canRetry: true };
  return { title: '불러오지 못했습니다', body: '네트워크 상태를 확인해주세요.', canRetry: true };
}

function FrameRow({ frame }: { frame: IncidentStackFrame }) {
  const location = [frame.lineNo, frame.colNo].filter((n) => n !== null).join(':');
  return (
    <View style={[styles.frame, frame.inApp && styles.frameInApp]}>
      <Text style={[styles.mono, styles.frameFunction, !frame.inApp && styles.dim]} numberOfLines={1}>
        {frame.function ?? '(익명 함수)'}
      </Text>
      <Text style={[styles.mono, styles.frameFile, !frame.inApp && styles.dim]} numberOfLines={2}>
        {frame.filename ?? '(알 수 없는 파일)'}
        {location ? `:${location}` : ''}
      </Text>
    </View>
  );
}

function BreadcrumbRow({ crumb }: { crumb: IncidentBreadcrumb }) {
  const isBad = crumb.level === 'error' || crumb.level === 'fatal' || crumb.level === 'warning';
  return (
    <View style={styles.crumb}>
      <Text style={[styles.mono, styles.crumbTime]}>{clockTime(crumb.timestamp)}</Text>
      <View style={styles.crumbBody}>
        <Text style={[styles.crumbCategory, isBad && { color: colors.warning }]}>{crumb.category ?? '-'}</Text>
        {crumb.message ? (
          <Text style={[styles.mono, styles.crumbMessage]} numberOfLines={3}>
            {crumb.message}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default function IncidentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isPending, isError, error, refetch, isRefetching } = useIncident(id);

  if (isPending) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom']}>
        <ActivityIndicator color={colors.accent} size="large" />
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

  const frames = data.exception?.frames ?? [];
  // breadcrumbs 는 시간순으로 오지만, 사고 직전 행동이 가장 궁금하므로 최근 것을 위에 둔다.
  const crumbs = [...data.breadcrumbs].reverse();

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} colors={[colors.accent]} />
        }
      >
        <View style={styles.card}>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, { backgroundColor: levelColor[data.level] ?? colors.error }]}>
              <Text style={styles.badgeText}>{data.level.toUpperCase()}</Text>
            </View>
            {data.project ? <Text style={styles.project}>{data.project}</Text> : null}
            {data.status !== 'unresolved' ? <Text style={styles.project}>· {data.status}</Text> : null}
          </View>
          <Text style={styles.title}>{data.title}</Text>
          {data.culprit ? <Text style={[styles.mono, styles.culprit]}>{data.culprit}</Text> : null}
          <Text style={styles.meta}>
            {data.count.toLocaleString()}회 · 최근 {timeAgo(data.lastSeen)} · 처음 {timeAgo(data.firstSeen)}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>스택트레이스</Text>
        <View style={styles.card}>
          {data.exception ? (
            <>
              <Text style={[styles.mono, styles.exceptionLine]}>
                {data.exception.type ?? 'Error'}
                {data.exception.value ? `: ${data.exception.value}` : ''}
              </Text>
              {frames.length > 0 ? (
                frames.map((frame, index) => <FrameRow key={index} frame={frame} />)
              ) : (
                <Text style={styles.empty}>스택 프레임이 없습니다.</Text>
              )}
            </>
          ) : (
            <Text style={styles.empty}>이 이벤트에는 예외 정보가 없습니다.</Text>
          )}
        </View>

        <Text style={styles.sectionTitle}>직전 행동 (breadcrumbs · 최근 순)</Text>
        <View style={styles.card}>
          {crumbs.length > 0 ? (
            crumbs.map((crumb, index) => <BreadcrumbRow key={index} crumb={crumb} />)
          ) : (
            <Text style={styles.empty}>기록된 행동이 없습니다.</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.sm },
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
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: { borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { color: '#0f1115', fontSize: 11, fontWeight: '700' },
  project: { color: colors.textMuted, fontSize: 12 },
  title: { color: colors.text, fontSize: 17, fontWeight: '600' },
  culprit: { color: colors.textMuted, fontSize: 12 },
  meta: { color: colors.textMuted, fontSize: 12 },
  sectionTitle: { color: colors.textMuted, fontSize: 12, marginTop: spacing.sm, marginLeft: spacing.xs },
  // 고정폭 글꼴 이름은 OS 마다 다르다 — 안드로이드는 'monospace', iOS 에는 그 이름이 없어 'Menlo' 를 쓴다.
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  exceptionLine: { color: colors.error, fontSize: 13 },
  frame: { borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: spacing.sm, gap: 2 },
  frameInApp: { borderLeftColor: colors.accent },
  frameFunction: { color: colors.text, fontSize: 12 },
  frameFile: { color: colors.textMuted, fontSize: 11 },
  dim: { opacity: 0.55 },
  crumb: { flexDirection: 'row', gap: spacing.sm },
  crumbTime: { color: colors.textMuted, fontSize: 11, width: 58 },
  crumbBody: { flex: 1, gap: 2 },
  crumbCategory: { color: colors.accent, fontSize: 11, fontWeight: '600' },
  crumbMessage: { color: colors.text, fontSize: 12 },
  empty: { color: colors.textMuted, fontSize: 13 },
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
});
