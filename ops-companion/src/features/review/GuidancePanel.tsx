/**
 * 채점 안내(Phase 7, 설계 §9 Phase 7) — 카드 두 곳에 들어가는 부품.
 *
 *   GuidancePanel  : 분석 위에 — "사실 메모"(무엇이 깨졌나 · 원인 위치 · 조치 방향 · 흔한 오답) + 원인 위치의 실제 코드(접이식)
 *   IdentifierChip : 분석 아래 — 조치 코드의 이름을 실제 코드와 대조한 결과(Phase 8). 항목 ②에 답할 **근거**이고 판정이 아니다
 *   Checklist      : 그 아래 — 확인 항목 4개, 각각 ✓ / ✗ 두 버튼(둘 다 안 누르면 "판단 못 함"=null)
 *   suggestVerdict : ①②(원인 위치 · 지어낸 식별자) 에서 승인/반려를 **제안**한다. 평가자는 스와이프로 덮어쓴다. 칩은 여기에 들어가지 않는다
 *
 * 왜 이렇게 나눴나: 채점자는 "메모를 읽고 → 답을 읽고 → 항목에 답한다" 순서로 움직인다. 메모가 답 아래에 있으면 답을 먼저
 * 읽고 인상으로 판정하게 된다(Phase 6 의 "그럴듯함에 점수"). 코드는 길어서 기본 접힘 — 항목 ②를 볼 때만 편다.
 *
 * 메모가 없는 인시던트(자연 발생·미조사)는 "메모 없음"을 그린다. 그 카드의 채점은 집계에서 참고 등급으로 따로 센다(withNote).
 * 메모·항목은 두 팔(프롬프트 버전)에 똑같이 붙는다 — 블라인드는 그대로다.
 */
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { IdentifierCheck, IncidentNote, ReviewCheckKey, ReviewChecklistItem, ReviewChecks, ReviewVerdict } from '../../lib/api';
import { CopyButton } from '../analysis/AnalysisCard';
import { colors, spacing } from '../../theme';

/** 메모 전체를 붙여넣기 좋은 텍스트로 — 채점 결과를 옮겨 적거나 다른 AI 에게 대조시킬 때(실기기 확인 중 사용자가 손으로 옮겨 적었다) */
export function noteToText(note: IncidentNote): string {
  const lines = [
    '[무엇이 어떻게 깨졌나]', note.symptom, '',
    '[원인 위치]', note.causeLocation, '',
    '[정답 조치의 방향]', note.fixDirection,
  ];
  if (note.commonMistakes) lines.push('', '[흔한 오답]', note.commonMistakes);
  if (note.code) lines.push('', `[원인 위치의 실제 코드 — ${note.code.path}:${note.code.startLine}-${note.code.endLine} @${note.code.ref}]`, note.code.text);
  return lines.join('\n');
}

/** 승인/반려 제안에 쓰는 항목. 백엔드 REVIEW_VERDICT_RULE_KEYS 와 같다 */
const RULE_KEYS: ReviewCheckKey[] = ['causeLocation', 'noInventedIdentifiers'];

/**
 * ①② 둘 중 하나라도 ✗ → 반려 제안 · 둘 다 ✓ → 승인 제안 · 그 밖(아직 안 답함) → 제안 없음.
 * ③④ 는 제안에 넣지 않는다 — "조치가 그대로 되는가"·"확신도"는 별점으로 반영하라고 안내만 한다.
 */
export function suggestVerdict(checks: ReviewChecks): ReviewVerdict | null {
  const values = RULE_KEYS.map((k) => checks[k]);
  if (values.some((v) => v === false)) return 'rejected';
  if (values.every((v) => v === true)) return 'approved';
  return null;
}

/** 답한 항목 수(true/false 만 센다) */
export function answeredCount(checks: ReviewChecks, items: ReviewChecklistItem[]): number {
  return items.filter((i) => typeof checks[i.key] === 'boolean').length;
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} selectable>
        {value}
      </Text>
    </View>
  );
}

export function GuidancePanel({ note }: { note: IncidentNote | null }) {
  const [open, setOpen] = useState(true);
  const [codeOpen, setCodeOpen] = useState(false);

  return (
    <View style={styles.panel}>
      <Pressable style={styles.header} onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityLabel="채점 안내 접기/펴기">
        <Text style={styles.headerTitle}>채점 안내 · 사실 메모</Text>
        <View style={styles.headerRight}>
          {note ? <CopyButton text={noteToText(note)} label="메모 복사" /> : null}
          <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
        </View>
      </Pressable>

      {open ? (
        note ? (
          <View style={styles.body}>
            <Text style={styles.lead}>사람이 미리 확인한 정답입니다. 아래 AI 답을 이 메모와 대조해 채점하세요.</Text>
            <Row label="무엇이 어떻게 깨졌나" value={note.symptom} />
            <Row label="원인 위치" value={note.causeLocation} />
            <Row label="정답 조치의 방향" value={note.fixDirection} />
            <Row label="흔한 오답" value={note.commonMistakes} />

            {note.code ? (
              <>
                <Pressable style={styles.codeToggle} onPress={() => setCodeOpen((v) => !v)} accessibilityRole="button">
                  <Text style={styles.codeToggleText}>
                    {codeOpen ? '▾' : '▸'} 원인 위치의 실제 코드 — {note.code.path}:{note.code.startLine}-{note.code.endLine} @{note.code.ref.slice(0, 7)}
                  </Text>
                </Pressable>
                {codeOpen ? (
                  <Text style={[styles.mono, styles.code]} selectable>
                    {note.code.text}
                  </Text>
                ) : (
                  <Text style={styles.codeHint}>항목 ②(지어낸 이름)를 볼 때 펴세요. AI 조치 코드의 변수·함수 이름이 여기 있는지 대조합니다.</Text>
                )}
              </>
            ) : null}
          </View>
        ) : (
          <View style={styles.body}>
            <Text style={styles.empty}>메모 없음 — 이 인시던트는 아직 조사되지 않았습니다.</Text>
            <Text style={styles.codeHint}>정답을 모르는 채 채점하는 카드입니다. 확신이 없으면 항목을 비워 두세요(집계에서 참고 등급으로 따로 셉니다).</Text>
          </View>
        )
      ) : null}
    </View>
  );
}

/**
 * 이름 대조 칩(Phase 8) — 네 상태를 그린다.
 *   undefined(옛 백엔드) → 안 그림 · null → "대조할 코드 없음" · checkedCount 0 → "조치에 코드 이름 없음" ·
 *   unknown 있음 → ⚠ 이름 나열(+ 라이브러리 꼴은 따로) · 없음 → ✓ 모두 있음
 * 왜 근거만 주고 ②를 대신 답하지 않나: Phase 7 에서 사람은 이름이 틀린 답을 통과시켰다(8편 6-5). 기계가 대조하되 결정은 사람이 —
 * 칩을 보고 ②에 ✗ 를 누르는 것은 여전히 평가자다. 잡지 못하는 것도 있다(다시 쓴 코드 · 파일에 다른 뜻으로 있는 이름).
 */
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
    <View style={[styles.chipPanel, { borderColor: toneColor }]}>
      <Text style={[styles.chipTitle, { color: toneColor }]} selectable>
        {title}
      </Text>
      {check && check.maybeLibrary.length > 0 ? (
        <Text style={styles.codeHint}>파일에 없지만 라이브러리 이름일 수 있음: {check.maybeLibrary.join(' · ')}</Text>
      ) : null}
      {check && check.checkedFiles.length > 0 ? (
        <Pressable onPress={() => setFilesOpen((v) => !v)} accessibilityRole="button">
          <Text style={styles.codeToggleText}>
            {filesOpen ? '▾' : '▸'} 대조한 파일 {check.checkedFiles.length}개
          </Text>
          {filesOpen
            ? check.checkedFiles.map((f) => (
                <Text key={f} style={[styles.mono, styles.codeHint]} numberOfLines={1}>
                  {f}
                </Text>
              ))
            : null}
        </Pressable>
      ) : null}
      <Text style={styles.codeHint}>항목 ②의 근거입니다. 판정은 평가자가 합니다 — 다시 쓴 코드나 다른 뜻으로 파일에 있는 이름은 잡지 못합니다.</Text>
    </View>
  );
}

function CheckRow({
  item,
  value,
  onChange,
}: {
  item: ReviewChecklistItem;
  value: boolean | null | undefined;
  onChange: (v: boolean | null) => void;
}) {
  const [howOpen, setHowOpen] = useState(false);
  return (
    <View style={styles.checkRow}>
      <Pressable onPress={() => setHowOpen((v) => !v)} style={styles.checkLabelWrap} accessibilityRole="button">
        <Text style={styles.checkLabel}>{item.label}</Text>
        {howOpen ? <Text style={styles.howTo}>{item.howTo}</Text> : <Text style={styles.howToHint}>확인 방법 보기</Text>}
      </Pressable>
      <View style={styles.checkButtons}>
        <Pressable
          onPress={() => onChange(value === true ? null : true)}
          style={[styles.checkButton, value === true && styles.checkPass]}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === true }}
          accessibilityLabel={`${item.key} 통과`}
        >
          <Text style={[styles.checkGlyph, value === true && styles.checkGlyphOn]}>✓</Text>
        </Pressable>
        <Pressable
          onPress={() => onChange(value === false ? null : false)}
          style={[styles.checkButton, value === false && styles.checkFail]}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === false }}
          accessibilityLabel={`${item.key} 실패`}
        >
          <Text style={[styles.checkGlyph, value === false && styles.checkGlyphOn]}>✗</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function Checklist({
  items,
  checks,
  onChange,
}: {
  items: ReviewChecklistItem[];
  checks: ReviewChecks;
  onChange: (key: ReviewCheckKey, value: boolean | null) => void;
}) {
  const suggestion = suggestVerdict(checks);
  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>확인 항목 {answeredCount(checks, items)}/{items.length}</Text>
        <Text style={[styles.suggest, suggestion === 'approved' && { color: colors.success }, suggestion === 'rejected' && { color: colors.error }]}>
          {suggestion === 'approved' ? '제안: 승인' : suggestion === 'rejected' ? '제안: 반려' : '①② 에 답하면 제안'}
        </Text>
      </View>
      <View style={styles.body}>
        {items.map((item) => (
          <CheckRow key={item.key} item={item} value={checks[item.key]} onChange={(v) => onChange(item.key, v)} />
        ))}
        <Text style={styles.codeHint}>①·② 중 하나라도 ✗ 면 반려를 제안합니다. ③·④ 는 별점에 반영하세요. 제안과 다르게 스와이프해도 됩니다.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  headerTitle: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chevron: { color: colors.accent, fontSize: 14 },
  body: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  lead: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  row: { gap: 2 },
  rowLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  rowValue: { color: colors.text, fontSize: 14, lineHeight: 20 },
  codeToggle: { paddingVertical: 4 },
  codeToggleText: { color: colors.accent, fontSize: 12 },
  codeHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  code: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 16,
    backgroundColor: colors.background,
    borderRadius: 8,
    padding: spacing.sm,
  },
  empty: { color: colors.warning, fontSize: 13, fontWeight: '600' },
  chipPanel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.xs,
  },
  chipTitle: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  suggest: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  checkLabelWrap: { flex: 1, gap: 2 },
  checkLabel: { color: colors.text, fontSize: 13, lineHeight: 18 },
  howTo: { color: colors.textMuted, fontSize: 11, lineHeight: 15 },
  howToHint: { color: colors.accent, fontSize: 11 },
  checkButtons: { flexDirection: 'row', gap: spacing.xs },
  checkButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkPass: { backgroundColor: colors.success, borderColor: colors.success },
  checkFail: { backgroundColor: colors.error, borderColor: colors.error },
  checkGlyph: { color: colors.textMuted, fontSize: 18, fontWeight: '700' },
  checkGlyphOn: { color: '#0f1115' },
});
