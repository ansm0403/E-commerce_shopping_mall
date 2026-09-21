/**
 * 별점 1~5 (설계 §4.3 S5 "카드 내 별점 선택 가능").
 * 판정(스와이프)과 별개다 — 안 고르면 null 로 보내지 않는다(백엔드 rating nullable).
 * 같은 별을 다시 누르면 해제. 별 하나가 44px 이상이라 엄지로도 정확히 눌린다.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../../theme';

interface Props {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}

export function StarRating({ value, onChange, disabled }: Props) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="별점">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value !== null && n <= value;
        return (
          <Pressable
            key={n}
            disabled={disabled}
            onPress={() => onChange(value === n ? null : n)}
            hitSlop={6}
            style={({ pressed }) => [styles.star, pressed && styles.pressed]}
            accessibilityRole="radio"
            accessibilityState={{ selected: filled }}
            accessibilityLabel={`${n}점`}
          >
            <Text style={[styles.glyph, filled ? styles.filled : styles.empty]}>{filled ? '★' : '☆'}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  star: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  glyph: { fontSize: 28, lineHeight: 32 },
  filled: { color: colors.warning },
  empty: { color: colors.textMuted },
});
