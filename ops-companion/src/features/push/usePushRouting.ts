/**
 * 푸시 알림 → 화면 이동 (설계 §4.2 딥링크 3상태).
 *
 * 알림을 탭하는 순간 앱이 어떤 상태였는지에 따라 경로가 다르다.
 *  1) **포그라운드**: 앱을 보고 있는 중. 배너가 떠 있고 탭하면 응답 리스너가 부른다.
 *  2) **백그라운드**: 앱이 살아 있지만 뒤에 있음. 같은 응답 리스너가 부른다.
 *  3) **종료(cold start)**: 앱이 죽어 있었다. 리스너를 붙이기 **전에** 이미 탭이 끝났으므로
 *     이벤트가 오지 않는다. 그래서 `getLastNotificationResponse()` 로 "마지막 탭"을 직접 읽는다.
 *     이 3번이 Phase 1 DoD 의 핵심이고 함정이 가장 많은 곳이다.
 *
 * 여기에 하나 더: **미로그인 상태**로 알림을 탭할 수 있다. 그때 목적지를 pending 으로 들고 있다가
 * 로그인에 성공한 뒤 이동한다(설계 §4.2 마지막 줄).
 */
import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useAuth } from '../../contexts/AuthContext';

/** 백엔드가 data.url 에 `/incidents/<id>` 를 담아 보낸다(ops-poller.service.ts toMessage). */
function toPath(notification: Notifications.Notification): string | null {
  const data = notification.request.content.data as { url?: unknown; incidentId?: unknown };
  if (typeof data?.url === 'string' && data.url.startsWith('/')) return data.url;
  // url 이 없는 옛 형식·수동 발송 대비. 우리가 아는 형태만 만들고 그 밖은 무시한다.
  if (typeof data?.incidentId === 'string') return `/incidents/${data.incidentId}`;
  return null;
}

export function usePushRouting(): void {
  const router = useRouter();
  const { user, isBooting } = useAuth();
  /** 로그인 전에 도착한 목적지. 로그인 성공 후 한 번 쓰고 비운다. */
  const pending = useRef<string | null>(null);
  const isSignedIn = user !== null && !isBooting;

  useEffect(() => {
    /** 지금 갈 수 있으면 가고, 아니면 들고 있는다. */
    const go = (path: string | null) => {
      if (!path) return;
      if (isSignedIn) router.push(path as never);
      else pending.current = path;
    };

    // 상태 3) 종료 상태에서 탭해 앱이 켜진 경우. 리스너보다 먼저 확인해야 한다.
    const last = Notifications.getLastNotificationResponse();
    if (last?.notification) {
      go(toPath(last.notification));
      // 다음 실행에서 같은 알림으로 또 이동하지 않도록 비운다(Async 버전은 deprecated).
      Notifications.clearLastNotificationResponse();
    }

    // 상태 1)·2) 앱이 살아 있는 동안의 탭.
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      go(toPath(response.notification));
    });

    return () => subscription.remove();
    // isSignedIn 이 바뀌면 리스너를 다시 달아 최신 로그인 상태를 보게 한다.
  }, [isSignedIn, router]);

  // 로그인 전에 받아 둔 목적지를 로그인 직후에 소비한다.
  useEffect(() => {
    if (!isSignedIn || !pending.current) return;
    const path = pending.current;
    pending.current = null;
    router.push(path as never);
  }, [isSignedIn, router]);
}
