/**
 * 지금 보고 있는 화면을 Sentry 태그 `screen` 으로 붙인다 (설계 §6 의 태그 행).
 *
 * 에러 하나만 놓고 보면 "어디서 터졌나"는 스택트레이스로 알 수 있다. 태그가 필요한 이유는
 * **모아서 볼 때**다 — Sentry 대시보드에서 `screen:(tabs)/incidents/[id]` 로 걸러
 * "이 화면에서만 에러가 몰린다"를 찾을 수 있다. 스택트레이스로는 그 집계가 안 된다.
 *
 * ⚠ `usePathname()` 이 아니라 `useSegments()` 를 쓴다.
 * pathname 은 실제 주소라 인시던트마다 `/incidents/7744504775`, `/incidents/7742712093` …
 * 으로 **값이 무한히 갈라진다**(높은 카디널리티). 태그 값이 갈라지면 집계가 불가능해지고
 * Sentry 쪽 태그 값 한도도 먹는다. segments 는 파일 경로 그대로라 `[id]` 가 `[id]` 로 남는다
 * (expo-router `useSegments.d.ts`: *"Segments are not normalized … `/[id]?id=normal` becomes `["[id]"]`"*).
 */
import { useEffect } from 'react';
import { useSegments } from 'expo-router';
import * as Sentry from '@sentry/react-native';

export function useScreenTag(): void {
  const segments = useSegments();

  useEffect(() => {
    const screen = segments.length > 0 ? segments.join('/') : '(root)';

    Sentry.setTag('screen', screen);
    // 화면 이동을 행동 기록으로도 남긴다. 에러가 났을 때 "어떤 경로로 들어왔나"가 보인다.
    // 값이 패턴이라 여기에는 인시던트 id 같은 식별자가 실리지 않는다.
    Sentry.addBreadcrumb({ category: 'navigation', message: screen, level: 'info' });
  }, [segments]);
}
