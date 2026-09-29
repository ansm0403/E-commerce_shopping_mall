/**
 * 외부에서 들어온 목적지 → 화면 이동 — 웹 체험판 전용(iOS·안드로이드는 usePushRouting.ts).
 *
 * 앱에서 "외부 진입"은 푸시 알림 탭이지만, 웹에는 푸시가 없다(notifications.ts 가 등록을 건너뛴다).
 * 게다가 네이티브 훅이 부르는 `getLastNotificationResponse` 는 웹 구현이 없어 첫 렌더에서 앱 전체가 멈춘다.
 * 웹의 외부 진입은 **URL** 이다 — 관리자 "운영 앱" 페이지의 "웹 체험판에서 열기"가 `/incidents/<id>` 를 연다.
 *
 * 로그인 전이면 Stack.Protected 가 /login 으로 돌려보내 목적지가 사라진다. 그래서 네이티브 훅의
 * pending 과 같은 일을 한다 — 처음 연 경로를 들고 있다가 로그인에 성공하면 그리로 간다.
 */
import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';

/**
 * 번들이 실행되는 순간(= 라우터가 /login 으로 돌려보내기 전)의 경로.
 * 인시던트 상세·분석만 되살린다 — 목록·로그인은 로그인 직후 기본 화면과 같아 할 일이 없다.
 */
const entryPath: string | null =
  typeof window !== 'undefined' && /^\/incidents\/(analysis\/)?[^/]+$/.test(window.location.pathname)
    ? window.location.pathname
    : null;

export function usePushRouting(): void {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isBooting } = useAuth();
  const pending = useRef(entryPath);
  const isSignedIn = user !== null && !isBooting;

  useEffect(() => {
    if (!isSignedIn || !pending.current) return;
    const path = pending.current;
    pending.current = null;
    // 이미 로그인된 채로 새로고침했다면 그 화면에 그대로 있다 — 한 번 더 쌓지 않는다.
    if (pathname !== path) router.push(path as never);
  }, [isSignedIn, pathname, router]);
}
