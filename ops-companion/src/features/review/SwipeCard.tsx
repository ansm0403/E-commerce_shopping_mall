/**
 * 스와이프 카드 (설계 §4.3 S5 "오른쪽 스와이프=승인, 왼쪽=반려").
 *
 * 두 라이브러리가 나눠 맡는다. 둘 다 Phase 0 부터 APK 안에 있어 재빌드가 필요 없다.
 *   - react-native-gesture-handler : 손가락을 **읽는다**(Pan = 끌기). 웹의 pointermove 에 해당하지만 네이티브 스레드에서 돈다
 *   - react-native-reanimated      : 값을 **움직인다**. shared value 는 JS 스레드가 아니라 UI 스레드에 사는 변수라,
 *                                    JS 가 바빠도(예: 목록 렌더) 카드가 손가락을 60fps 로 따라온다
 *
 * worklet: 'worklet' 표식이 붙은(또는 제스처 콜백처럼 자동으로 붙는) 함수는 UI 스레드에서 실행된다. 그 안에서 React 상태나
 * 일반 JS 함수를 부르려면 runOnJS 로 JS 스레드에 넘겨야 한다 — onSwipe 가 그렇게 호출된다.
 *
 * 카드는 "날아간 뒤" 부모에게 알린다. 부모는 그 카드를 목록에서 빼고(낙관적 업데이트) 다음 카드를 같은 자리에 그린다.
 * key 가 바뀌므로 새 카드는 translateX=0 에서 시작한다.
 */
import { forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { ReviewVerdict } from '../../lib/api';
import { colors } from '../../theme';

export interface SwipeCardHandle {
  /** 버튼으로도 같은 애니메이션을 탄다(제스처가 안 먹는 기기·접근성 대비) */
  swipe: (verdict: ReviewVerdict) => void;
}

interface Props {
  children: ReactNode;
  onSwipe: (verdict: ReviewVerdict) => void;
  /** 저장 중 등 잠깐 막을 때 */
  enabled?: boolean;
}

/** 화면 폭의 이 비율을 넘기면 판정. 그 전에 놓으면 제자리로 */
const THRESHOLD_RATIO = 0.35;
/** 짧게 휙 던져도 판정으로 본다(px/s) */
const FLING_VELOCITY = 900;

export const SwipeCard = forwardRef<SwipeCardHandle, Props>(function SwipeCard({ children, onSwipe, enabled = true }, ref) {
  const { width } = useWindowDimensions();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  /** 화면 밖으로 날려 보낸 뒤 JS 에 판정을 알린다. UI 스레드에서 도는 worklet 이다 */
  const flyOut = (direction: 1 | -1) => {
    'worklet';
    const verdict: ReviewVerdict = direction > 0 ? 'approved' : 'rejected';
    tx.value = withTiming(direction * width * 1.5, { duration: 220 }, (finished) => {
      if (finished) runOnJS(onSwipe)(verdict);
    });
  };

  useImperativeHandle(ref, () => ({
    swipe: (verdict) => {
      if (!enabled) return;
      // JS 에서 부르지만 flyOut 은 worklet 이다 — reanimated 가 shared value 대입을 UI 스레드로 넘긴다
      flyOut(verdict === 'approved' ? 1 : -1);
    },
  }));

  const pan = Gesture.Pan()
    .enabled(enabled)
    // 가로로 16px 이상 움직여야 이 제스처가 시작된다. 그 전에 세로로 12px 움직이면 이 제스처는 실패하고
    // 카드 안 ScrollView 가 스크롤을 가져간다 — 긴 분석을 읽으려 위아래로 긁을 때 카드가 딸려 오지 않게
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY * 0.3;
    })
    .onEnd((e) => {
      const past = Math.abs(e.translationX) > width * THRESHOLD_RATIO;
      const flung = Math.abs(e.velocityX) > FLING_VELOCITY;
      if (past || flung) {
        flyOut(e.translationX + e.velocityX * 0.2 > 0 ? 1 : -1);
        return;
      }
      tx.value = withSpring(0, { damping: 18, stiffness: 180 });
      ty.value = withSpring(0, { damping: 18, stiffness: 180 });
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotateZ: `${interpolate(tx.value, [-width, 0, width], [-12, 0, 12], Extrapolation.CLAMP)}deg` },
    ],
  }));
  const approveStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, width * 0.2], [0, 1], Extrapolation.CLAMP),
  }));
  const rejectStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-width * 0.2, 0], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.card, cardStyle]}>
        {children}
        {/* 끌수록 진해지는 판정 라벨 — 놓기 전에 어느 쪽으로 가는지 보인다 */}
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampApprove, approveStyle]}>
          <Text style={[styles.stampText, { color: colors.success }]}>승인</Text>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampReject, rejectStyle]}>
          <Text style={[styles.stampText, { color: colors.error }]}>반려</Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  stamp: {
    position: 'absolute',
    top: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 3,
    borderRadius: 8,
    transform: [{ rotateZ: '-12deg' }],
  },
  stampApprove: { left: 16, borderColor: colors.success },
  stampReject: { right: 16, borderColor: colors.error, transform: [{ rotateZ: '12deg' }] },
  stampText: { fontSize: 22, fontWeight: '800', letterSpacing: 2 },
});
