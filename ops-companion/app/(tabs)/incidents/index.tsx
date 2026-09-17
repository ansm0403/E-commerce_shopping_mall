/**
 * S2. IncidentListScreen (설계 §4.3 S2).
 *
 * 데이터는 GET /v1/ops/incidents — 백엔드가 Sentry 를 대신 조회해 5개 필드로 축약해 준다.
 * 로딩·빈 상태·에러 상태를 각각 그린다(설계 §4.3 S2 요구사항).
 * pull-to-refresh 는 쿼리를 다시 당기지만, 백엔드가 60초 Redis 캐시를 두고 있어
 * 연타해도 Sentry 를 직접 때리지 않는다(설계 §3.2).
 *
 * crash-free 요약 카드는 Phase 2 에서 실데이터가 생길 때 추가한다(지금은 표시하지 않음).
 */
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AxiosError } from 'axios';
import { useIncidents } from '../../../src/features/incidents/queries';
import type { IncidentSummary } from '../../../src/lib/api';
import { colors, levelColor, spacing } from '../../../src/theme';

/** "3분 전" 같은 상대 시각. 운영 화면에서는 절대 시각보다 이쪽이 빨리 읽힌다. */
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs)) return iso;

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function errorMessage(error: unknown): string {
  const status = (error as AxiosError)?.response?.status;
  if (status === 403) return '관리자 권한이 필요합니다.';
  if (status === 503) return '백엔드에 Sentry 연동이 설정되지 않았습니다.';
  if (status === 502) return 'Sentry 조회에 실패했습니다. 잠시 후 다시 시도해주세요.';
  return '인시던트를 불러오지 못했습니다. 네트워크 상태를 확인해주세요.';
}

function IncidentRow({ item }: { item: IncidentSummary }) {
  return (
    <View style={styles.row}>
      <View style={[styles.levelDot, { backgroundColor: levelColor[item.level] ?? colors.error }]} />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.rowMeta}>
          {item.count.toLocaleString()}회 · {timeAgo(item.lastSeen)}
        </Text>
      </View>
    </View>
  );
}

export default function IncidentListScreen() {
  const { data, isPending, isError, error, refetch, isRefetching } = useIncidents();

  const renderItem = useCallback(
    ({ item }: { item: IncidentSummary }) => <IncidentRow item={item} />,
    [],
  );

  if (isPending) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom']}>
        <ActivityIndicator color={colors.accent} size="large" />
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom']}>
        <Text style={styles.stateTitle}>불러오지 못했습니다</Text>
        <Text style={styles.stateBody}>{errorMessage(error)}</Text>
        <Pressable style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryText}>다시 시도</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={data.length === 0 ? styles.emptyContainer : styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        ListHeaderComponent={
          data.length > 0 ? <Text style={styles.listHeader}>최근 24시간 · {data.length}건</Text> : null
        }
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.stateTitle}>조용합니다</Text>
            <Text style={styles.stateBody}>최근 24시간 동안 기록된 인시던트가 없습니다.</Text>
          </View>
        }
      />
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
  listContent: { padding: spacing.md, gap: spacing.sm },
  emptyContainer: { flexGrow: 1 },
  listHeader: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.md,
  },
  levelDot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  rowBody: { flex: 1, gap: spacing.xs },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: colors.textMuted, fontSize: 12 },
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
