/**
 * 이름 대조 칩(Phase 8) — 조치 코드의 이름(변수·함수·환경변수)을 백엔드가 실제 소스 파일과 대조한 결과.
 * S4(분석 상세)와 S5(채점 카드) 모두 AnalysisCard 의 "추천 조치" 바로 아래에 그린다 — 조치를 붙여 넣으려는 사람이
 * 채점 카드가 아니라 여기서 먼저 봐야 하는 경고다(Phase 8 후속에서 S5 전용 → 공용으로 옮김).
 *
 * 네 상태:
 *   undefined(옛 백엔드) → 안 그림 · null → "대조할 코드 없음" · checkedCount 0 → "조치에 코드 이름 없음" ·
 *   unknown 있음 → ⚠ 이름 나열(+ 라이브러리 꼴은 따로) · 없음 → ✓ 모두 있음
 * 판정이 아니다 — S5 의 승인/반려 제안(suggestVerdict)에 들어가지 않는다. 잡지 못하는 것도 있다(다시 쓴 코드 · 파일에 다른 뜻으로 있는 이름).
 */
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { IdentifierCheck } from '../../lib/api';
import { colors, spacing } from '../../theme';

export function IdentifierChip({ check }: { check: IdentifierCheck | null | undefined }) {
  // 훅은 early return 앞에 — 옛 백엔드(필드 없음)에서도 훅 순서가 흔들리지 않게
  const [filesOpen, setFilesOpen] = useState(false);
  if (check === undefined) return null;

  let tone: 'warn' | 'ok' | 'muted' = 'muted';
  let title: string;
  if (check === null) {
    title = '대조할 코드 없음 — 관련 파일을 읽지 못했습니다';
  } else if (check.checkedCount === 0) {
    title = '조치에 대조할 코드 이름이 없습니다';
  } else if (check.unknown.length > 0) {
    tone = 'warn';
    title = `⚠ 실제 코드에 없는 이름: ${check.unknown.join(' · ')}`;
  } else {
    tone = 'ok';
    title = `✓ 조치 코드의 이름 ${check.checkedCount}개가 모두 실제 코드에 있습니다`;
  }
  const toneColor = tone === 'warn' ? colors.warning : tone === 'ok' ? colors.success : colors.textMuted;

  return (
    <View style={[styles.panel, { borderColor: toneColor }]}>
      <Text style={[styles.title, { color: toneColor }]} selectable>
        {title}
      </Text>
      {tone === 'warn' ? <Text style={styles.hint}>이 이름은 대조한 파일에 없습니다. 조치를 그대로 붙여 넣기 전에 실제 이름을 확인하세요.</Text> : null}
      {check && check.maybeLibrary.length > 0 ? (
        <Text style={styles.hint}>파일에 없지만 라이브러리 이름일 수 있음: {check.maybeLibrary.join(' · ')}</Text>
      ) : null}
      {check && check.checkedFiles.length > 0 ? (
        <Pressable onPress={() => setFilesOpen((v) => !v)} accessibilityRole="button">
          <Text style={styles.toggle}>
            {filesOpen ? '▾' : '▸'} 대조한 파일 {check.checkedFiles.length}개
          </Text>
          {filesOpen
            ? check.checkedFiles.map((f) => (
                <Text key={f} style={[styles.mono, styles.hint]} numberOfLines={1}>
                  {f}
                </Text>
              ))
            : null}
        </Pressable>
      ) : null}
      <Text style={styles.hint}>단어 대조입니다 — 다시 쓴 코드나 다른 뜻으로 파일에 있는 이름은 잡지 못합니다. 판정은 사람이 합니다.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.xs,
  },
  title: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  hint: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  toggle: { color: colors.accent, fontSize: 12 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
});
