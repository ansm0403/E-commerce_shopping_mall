/**
 * S4 AnalysisScreen 의 본문 두 가지 (설계 §4.3 S4).
 *
 *  - AnalysisCard   : status='ok'  — 심각도 뱃지 / 원인 / 추천 조치(모노스페이스) / 관련 파일 칩
 *  - FallbackCard   : status='parse_failed' — 모델 원문 + "다시 분석" 버튼
 *
 * 방어 렌더링(설계 §3.4 (b)): 백엔드가 검증을 통과시킨 결과라도 필드마다 없을 수 있다고 보고 그린다.
 * 알 수 없는 severity 는 회색, 빈 relatedFiles 는 칩 없이, 빈 본문은 "(없음)". 어떤 값이 와도 이 컴포넌트는
 * 예외를 던지지 않는다 — DoD 의 "AI 가 스키마를 어겨도 앱이 깨지지 않는다"가 여기 걸려 있다.
 */
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { AiAnalysis, IncidentAnalysis } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { colors, severityColor, spacing } from '../../theme';

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
 * 작은 "복사" 버튼. 누르면 클립보드에 넣고 1.5초 동안 "복사됨" 으로 바뀐다.
 *
 * 왜 있나: 분석을 다른 AI 에게 이중 검증시키거나 이슈 트래커에 붙일 때 폰에서 길게 눌러 드래그하는 것은
 * 고역이다(실기기 확인 중 사용자가 결과를 손으로 옮겨 적었다). 클립보드는 expo-clipboard —
 * 웹의 navigator.clipboard 에 해당하는 네이티브 모듈이다.
 */
export function CopyButton({ text, label = '복사' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onPress = async () => {
    await Clipboard.setStringAsync(text);
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

/** 분석 메타 한 줄 — "gemini-3.1-flash-lite · v1 · 3.2초 · 5분 전". 어느 모델·프롬프트가 만든 답인지 화면에서 보인다 */
export function AnalysisMeta({ analysis }: { analysis: IncidentAnalysis }) {
  const seconds = analysis.latencyMs > 0 ? `${(analysis.latencyMs / 1000).toFixed(1)}초` : null;
  const parts = [analysis.model ?? '모델 미상', `프롬프트 ${analysis.promptVersion}`, seconds, timeAgo(analysis.createdAt)].filter(
    Boolean,
  );
  return <Text style={styles.meta}>{parts.join(' · ')}</Text>;
}

export function AnalysisCard({ result }: { result: Partial<AiAnalysis> | null | undefined }) {
  const severity = typeof result?.severity === 'string' ? result.severity : null;
  const confidence = typeof result?.confidence === 'string' ? result.confidence : null;
  const files = Array.isArray(result?.relatedFiles) ? result.relatedFiles.filter((f) => typeof f === 'string') : [];

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
