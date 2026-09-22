/**
 * S4 AnalysisScreen 의 본문 두 가지 (설계 §4.3 S4).
 *
 *  - AnalysisCard   : status='ok'  — 심각도 뱃지 / 원인 / 추천 조치(모노스페이스) / 관련 파일 칩 / AI 가 읽은 코드(Phase 5)
 *  - FallbackCard   : status='parse_failed' — 모델 원문 + "다시 분석" 버튼
 *
 * 방어 렌더링(설계 §3.4 (b)): 백엔드가 검증을 통과시킨 결과라도 필드마다 없을 수 있다고 보고 그린다.
 * 알 수 없는 severity 는 회색, 빈 relatedFiles 는 칩 없이, 빈 본문은 "(없음)". 어떤 값이 와도 이 컴포넌트는
 * 예외를 던지지 않는다 — DoD 의 "AI 가 스키마를 어겨도 앱이 깨지지 않는다"가 여기 걸려 있다.
 */
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type { AiAnalysis, AnalysisToolCall, IdentifierCheck, IncidentAnalysis } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { colors, severityColor, spacing } from '../../theme';
import { IdentifierChip } from './IdentifierChip';

const SEVERITY_LABEL: Record<string, string> = {
  critical: '치명적',
  high: '높음',
  medium: '보통',
  low: '낮음',
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: '확신도 높음',
  medium: '확신도 보통',
  low: '확신도 낮음',
};

/**
 * expo-clipboard 의 네이티브 쪽(ExpoClipboard)이 **이 APK 안에 있는가.**
 *
 * ⚠ expo-clipboard 를 파일 맨 위에서 `import` 하면 안 된다. 그 패키지는 불러오는 순간
 * `requireNativeModule('ExpoClipboard')` 를 부르고, 네이티브 코드가 없는 APK(패키지를 넣기 전에 만든
 * 개발 빌드)에서는 거기서 던진다 — 이 파일을 쓰는 분석 화면 전체가 import 단계에서 죽는다(학습 노트 4편 6-9).
 * 그래서 존재 여부를 **던지지 않는** requireOptionalNativeModule 로 먼저 보고, 있을 때만 require 한다.
 */
const HAS_NATIVE_CLIPBOARD = requireOptionalNativeModule('ExpoClipboard') !== null;

/**
 * 텍스트를 클립보드에 넣는다. 네이티브 모듈이 없는 빌드에서는 RN 기본 공유 시트(Share)로 대신한다 —
 * 공유 시트에도 "복사" 가 있으므로 한 번 더 누르면 같은 결과다. 반환값으로 어느 길을 탔는지 알린다.
 */
async function copyText(text: string): Promise<'copied' | 'shared'> {
  if (HAS_NATIVE_CLIPBOARD) {
    // 여기까지 와야 비로소 패키지를 평가한다(Metro 는 require 시점에 모듈을 실행한다).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
    await Clipboard.setStringAsync(text);
    return 'copied';
  }
  await Share.share({ message: text });
  return 'shared';
}

/**
 * 작은 "복사" 버튼. 누르면 클립보드에 넣고 1.5초 동안 "복사됨" 으로 바뀐다.
 *
 * 왜 있나: 분석을 다른 AI 에게 이중 검증시키거나 이슈 트래커에 붙일 때 폰에서 길게 눌러 드래그하는 것은
 * 고역이다(실기기 확인 중 사용자가 결과를 손으로 옮겨 적었다). 클립보드는 expo-clipboard —
 * 웹의 navigator.clipboard 에 해당하는 네이티브 모듈이다. 없는 빌드에서는 공유 시트가 뜬다(copyText).
 */
export function CopyButton({ text, label = '복사' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onPress = async () => {
    const how = await copyText(text).catch(() => null);
    // 공유 시트로 넘어간 경우는 사용자가 시트에서 고른 동작이 결과다 — "복사됨" 을 띄우지 않는다.
    if (how !== 'copied') return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Pressable style={({ pressed }) => [styles.copyButton, pressed && styles.copyPressed]} onPress={onPress} hitSlop={8}>
      <Text style={[styles.copyText, copied && styles.copiedText]}>{copied ? '복사됨 ✓' : label}</Text>
    </Pressable>
  );
}

/** 섹션 제목 + 오른쪽 복사 버튼 한 줄 */
function SectionHeader({ title, copyText }: { title: string; copyText?: string | null }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {copyText ? <CopyButton text={copyText} /> : null}
    </View>
  );
}

/**
 * 분석 전체를 붙여넣기 좋은 텍스트로. 다른 AI 에게 "이 분석이 맞나?" 라고 물을 때 쓰는 형태라
 * 라벨을 붙이고 관련 파일도 함께 넣는다.
 */
export function analysisToText(result: Partial<AiAnalysis> | null | undefined): string {
  const files = Array.isArray(result?.relatedFiles) ? result.relatedFiles.filter((f) => typeof f === 'string') : [];
  return [
    `심각도: ${result?.severity ?? '-'} / 확신도: ${result?.confidence ?? '-'}`,
    '',
    '[원인]',
    nonEmpty(result?.rootCause) ?? '(없음)',
    '',
    '[추천 조치]',
    nonEmpty(result?.suggestedFix) ?? '(없음)',
    '',
    '[관련 파일]',
    files.length > 0 ? files.join('\n') : '(없음)',
  ].join('\n');
}

/** 도구 기록 중 실제로 읽힌 것만. 값이 이상해도(옛 행·다른 백엔드) 빈 배열로 — 화면은 던지지 않는다 */
function okToolCalls(calls: unknown): AnalysisToolCall[] {
  return Array.isArray(calls) ? (calls as AnalysisToolCall[]).filter((c) => c && typeof c === 'object' && typeof c.path === 'string') : [];
}

/**
 * 분석 메타 한 줄 — "gemini-3.1-flash-lite · 프롬프트 v3 (코드 2) · 3.2초 · 5분 전".
 * 어느 모델·프롬프트가 만든 답인지 화면에서 보인다. "(예시 n)" 은 few-shot 예시가 들어간 v2 에서만(Phase 4),
 * "(코드 n)" 은 소스 코드를 실제로 읽은 v3 에서만 붙는다(Phase 5).
 * 평가 카드(S5)는 이 줄을 쓰지 않는다 — 버전을 보여주면 블라인드가 깨진다.
 */
export function AnalysisMeta({ analysis }: { analysis: IncidentAnalysis }) {
  const seconds = analysis.latencyMs > 0 ? `${(analysis.latencyMs / 1000).toFixed(1)}초` : null;
  const fewShot = Array.isArray(analysis.fewShotIds) && analysis.fewShotIds.length > 0 ? ` (예시 ${analysis.fewShotIds.length})` : '';
  const read = okToolCalls(analysis.toolCalls).filter((c) => c.ok).length;
  const code = read > 0 ? ` (코드 ${read})` : '';
  const parts = [analysis.model ?? '모델 미상', `프롬프트 ${analysis.promptVersion}${fewShot}${code}`, seconds, timeAgo(analysis.createdAt)].filter(
    Boolean,
  );
  return <Text style={styles.meta}>{parts.join(' · ')}</Text>;
}

/** "backend/src/main.ts:40-90" 꼴의 칩 라벨. 줄 정보가 없으면 경로만 */
function toolCallLabel(c: AnalysisToolCall): string {
  const range = c.startLine !== null && c.endLine !== null ? `:${c.startLine}-${c.endLine}` : c.startLine !== null ? `:${c.startLine}` : '';
  return `${c.path}${range}`;
}

/**
 * "AI 가 읽은 코드" 섹션(Phase 5). 백엔드의 tool_calls 기록 — AI 가 답하기 전에 실제로 열어 본 파일:줄이다.
 * 이 섹션이 있어야 "근거 있는 지적"과 "추측"을 화면에서 구분할 수 있다. 읽지 못한 호출(ok=false)은 사유와 함께 흐리게.
 *
 *  - toolCalls 가 null/없음(v1·v2·옛 행) → 섹션 자체를 그리지 않는다(도구가 없던 분석에 "안 읽었다"고 쓰면 오해)
 *  - [] (도구를 줬지만 안 읽음) → "읽지 않고 답했다" 한 줄. 스택이 번들 좌표면 이렇게 된다
 */
function ToolCallsSection({ toolCalls, copyText }: { toolCalls: unknown; copyText: string | null }) {
  if (!Array.isArray(toolCalls)) return null;
  const calls = okToolCalls(toolCalls);
  const ref = calls.find((c) => typeof c.ref === 'string')?.ref;
  return (
    <>
      <SectionHeader title={`AI 가 읽은 코드${ref ? ` · ${ref.length > 12 ? ref.slice(0, 12) : ref}` : ''}`} copyText={copyText} />
      <View style={styles.card}>
        {calls.length > 0 ? (
          <View style={styles.chips}>
            {calls.map((c, i) => (
              <View key={`${toolCallLabel(c)}-${i}`} style={[styles.chip, !c.ok && styles.chipFailed]}>
                <Text style={[styles.mono, styles.chipText, !c.ok && styles.chipTextFailed]} numberOfLines={1}>
                  {c.ok ? toolCallLabel(c) : `✗ ${toolCallLabel(c)}${c.reason ? ` — ${c.reason}` : ''}`}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.empty}>코드를 읽지 않고 답했습니다. 스택트레이스가 원본 파일을 가리키지 않으면 이렇게 됩니다.</Text>
        )}
      </View>
    </>
  );
}

export function AnalysisCard({
  result,
  toolCalls,
  identifierCheck,
}: {
  result: Partial<AiAnalysis> | null | undefined;
  /** 백엔드의 tool_calls(Phase 5). 안 넘기면(평가 카드 등) 섹션을 그리지 않는다 */
  toolCalls?: unknown;
  /** 조치 코드 이름 대조(Phase 8). "추천 조치" 바로 아래에 칩으로. undefined 면 그리지 않는다(옛 백엔드) */
  identifierCheck?: IdentifierCheck | null;
}) {
  const severity = typeof result?.severity === 'string' ? result.severity : null;
  const confidence = typeof result?.confidence === 'string' ? result.confidence : null;
  const files = Array.isArray(result?.relatedFiles) ? result.relatedFiles.filter((f) => typeof f === 'string') : [];
  const readLabels = okToolCalls(toolCalls).filter((c) => c.ok).map(toolCallLabel);

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: (severity && severityColor[severity as keyof typeof severityColor]) || colors.textMuted }]}>
            <Text style={styles.badgeText}>{(severity && SEVERITY_LABEL[severity]) ?? severity?.toUpperCase() ?? '심각도 미상'}</Text>
          </View>
          <Text style={styles.confidence}>{(confidence && CONFIDENCE_LABEL[confidence]) ?? confidence ?? ''}</Text>
        </View>
      </View>

      <SectionHeader title="원인" copyText={nonEmpty(result?.rootCause)} />
      <View style={styles.card}>
        <Text style={styles.body} selectable>
          {nonEmpty(result?.rootCause) ?? '(원인 설명이 없습니다)'}
        </Text>
      </View>

      <SectionHeader title="추천 조치" copyText={nonEmpty(result?.suggestedFix)} />
      <View style={styles.card}>
        {/* 코드 예시가 섞여 오므로 통째로 고정폭. 마크다운 렌더러를 넣지 않는다 — 의존성 하나 값을 못 한다 */}
        <Text style={[styles.mono, styles.code]} selectable>
          {nonEmpty(result?.suggestedFix) ?? '(추천 조치가 없습니다)'}
        </Text>
      </View>
      {/* Phase 8: 조치 코드의 이름이 실제 파일에 있는가 — 붙여 넣기 전에 봐야 하는 경고라 조치 바로 아래 */}
      <IdentifierChip check={identifierCheck} />

      <SectionHeader title="관련 파일" copyText={files.length > 0 ? files.join('\n') : null} />
      <View style={styles.card}>
        {files.length > 0 ? (
          <View style={styles.chips}>
            {files.map((file) => (
              <View key={file} style={styles.chip}>
                <Text style={[styles.mono, styles.chipText]} numberOfLines={1}>
                  {file}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.empty}>스택트레이스에서 추정한 파일이 없습니다.</Text>
        )}
      </View>

      <ToolCallsSection toolCalls={toolCalls} copyText={readLabels.length > 0 ? readLabels.join('\n') : null} />
    </View>
  );
}

export function FallbackCard({
  rawText,
  onRetry,
  isRetrying,
}: {
  rawText: string | null;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <View style={styles.stack}>
      <View style={[styles.card, styles.fallbackCard]}>
        <Text style={styles.fallbackTitle}>구조화하지 못했습니다</Text>
        <Text style={styles.fallbackBody}>
          AI 가 정해진 형식(JSON)으로 답하지 않아 카드로 만들지 못했습니다. 아래는 받은 원문 그대로입니다.
        </Text>
      </View>

      <SectionHeader title="원문" copyText={nonEmpty(rawText)} />
      <View style={styles.card}>
        <Text style={[styles.mono, styles.code]} selectable>
          {nonEmpty(rawText) ?? '(원문이 비어 있습니다)'}
        </Text>
      </View>

      <Pressable style={[styles.retryButton, isRetrying && styles.retryDisabled]} onPress={onRetry} disabled={isRetrying}>
        <Text style={styles.retryText}>{isRetrying ? '다시 분석 중…' : '다시 분석'}</Text>
      </Pressable>
    </View>
  );
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  badgeText: { color: '#0f1115', fontSize: 12, fontWeight: '700' },
  confidence: { color: colors.textMuted, fontSize: 12 },
  meta: { color: colors.textMuted, fontSize: 12, marginLeft: spacing.xs },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginHorizontal: spacing.xs,
  },
  sectionTitle: { color: colors.textMuted, fontSize: 12 },
  copyButton: { borderColor: colors.border, borderWidth: 1, borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  copyPressed: { opacity: 0.6 },
  copyText: { color: colors.textMuted, fontSize: 11 },
  copiedText: { color: colors.success },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  code: { color: colors.text, fontSize: 12, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    maxWidth: '100%',
  },
  chipText: { color: colors.accent, fontSize: 11 },
  chipFailed: { borderStyle: 'dashed', opacity: 0.7 },
  chipTextFailed: { color: colors.textMuted },
  empty: { color: colors.textMuted, fontSize: 13 },
  fallbackCard: { borderColor: colors.warning },
  fallbackTitle: { color: colors.warning, fontSize: 16, fontWeight: '600' },
  fallbackBody: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  retryButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  retryDisabled: { opacity: 0.6 },
  retryText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
