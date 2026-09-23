/**
 * 푸시 알림 등록 (설계 §3.3 · Phase 1).
 *
 * 이 파일이 하는 일은 셋뿐이다.
 *  1) 안드로이드 **알림 채널** 만들기
 *  2) 사용자에게 **알림 권한** 받기
 *  3) Expo 서버에서 **푸시 토큰** 받아 우리 백엔드에 등록하기
 *
 * ⚠ Expo Go 에서는 3번이 되지 않는다. SDK 53 부터 안드로이드 Expo Go 에는 원격 푸시가 빠졌다
 * (공식 문서: "A development build is required to use push notifications"). 그래서 이 함수는
 * Expo Go 에서 조용히 포기하고 이유를 돌려준다 — 앱의 다른 기능은 그대로 쓸 수 있어야 한다.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { registerDevice } from './api';

/** 등록 시도의 결과. 프로필 화면이 이 값을 그대로 보여준다. */
export type PushRegistration =
  | { status: 'registered'; token: string }
  | { status: 'denied' }
  /** demo = 데모 계정이라 백엔드가 등록을 받지 않았다(외부 방문자의 폰에 운영 장애 푸시 금지) */
  | { status: 'unsupported'; reason: 'expo-go' | 'simulator' | 'no-project-id' | 'demo' }
  | { status: 'error'; message: string };

/**
 * 알림 채널 — 안드로이드에서 "이 알림은 얼마나 시끄러운가"를 정하는 묶음이다(iOS 에는 없는 개념).
 * 백엔드가 보내는 message.channelId 와 이름이 같아야 이 설정이 적용된다.
 * 안드로이드 13+ 에서는 **권한을 묻기 전에 채널이 있어야** 하므로 순서가 중요하다.
 */
export const INCIDENT_CHANNEL_ID = 'incidents';

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(INCIDENT_CHANNEL_ID, {
    name: '장애 알림',
    // MAX = 화면 위로 떠오르는 헤드업 알림. 온콜 알림이라 놓치면 의미가 없다.
    importance: Notifications.AndroidImportance.MAX,
    // ⚠ `sound` 는 **넣지 않는다**. 이 옵션은 앱에 번들된 사운드 **파일 이름**을 받는 자리라,
    // 'default' 를 주면 "default 라는 파일이 없다"는 에러를 로그에 남긴다
    // (expo-notifications/android/.../NotificationsChannelManager.java customSoundExists).
    // 키가 없으면 네이티브가 Settings.System.DEFAULT_NOTIFICATION_URI(시스템 기본 소리)를 쓴다.
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF6B6B',
  });
}

/**
 * Expo Go 인지 판별한다. `Constants.appOwnership === 'expo'` 가 Expo Go 이고,
 * 개발 빌드·릴리즈 빌드에서는 null 이다.
 */
function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

/** app.json 의 extra.eas.projectId. 이 값이 없으면 Expo 가 토큰을 발급해 주지 않는다. */
function getProjectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

/**
 * 권한 → 토큰 → 백엔드 등록까지 한 번에. 로그인 직후와 앱을 다시 열 때마다 불러도 안전하다
 * (백엔드가 upsert 이므로 행이 늘지 않는다).
 */
export async function registerForPushNotifications(): Promise<PushRegistration> {
  if (!Device.isDevice) {
    // 에뮬레이터·시뮬레이터에는 푸시를 보낼 대상 자체가 없다.
    return { status: 'unsupported', reason: 'simulator' };
  }

  try {
    await ensureAndroidChannel();

    // 이미 허락했는지 먼저 본다. 매번 요청하면 안드로이드가 두 번째부터 조용히 거절한다.
    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return { status: 'denied' };

    if (isExpoGo()) {
      // 채널·권한까지는 Expo Go 에서도 되지만 토큰 발급이 막혀 있다. 여기서 멈춘다.
      return { status: 'unsupported', reason: 'expo-go' };
    }

    const projectId = getProjectId();
    if (!projectId) return { status: 'unsupported', reason: 'no-project-id' };

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const result = await registerDevice(token, Platform.OS === 'ios' ? 'ios' : 'android');
    if (!result.registered) {
      // 백엔드가 받지 않았다(지금은 데모 계정뿐). 토큰은 발급됐지만 발송 대상이 아니므로 화면에도 보여주지 않는다.
      return { status: 'unsupported', reason: result.reason ?? 'demo' };
    }
    return { status: 'registered', token };
  } catch (err) {
    return { status: 'error', message: (err as Error).message };
  }
}

/** 프로필 화면에 그대로 띄울 한 줄. 실패 이유를 사람 말로 바꾼다. */
export function describeRegistration(reg: PushRegistration | null): string {
  if (!reg) return '확인 중…';
  switch (reg.status) {
    case 'registered':
      return '켜짐 — 이 기기로 장애 알림이 옵니다';
    case 'denied':
      return '꺼짐 — 기기 설정에서 알림을 허용해주세요';
    case 'unsupported':
      return reg.reason === 'expo-go'
        ? '불가 — Expo Go 는 원격 푸시를 받지 못합니다(개발 빌드 필요)'
        : reg.reason === 'simulator'
          ? '불가 — 실기기에서만 동작합니다'
          : reg.reason === 'demo'
            ? '꺼짐 — 데모 계정은 장애 알림을 받지 않습니다'
            : '불가 — EAS projectId 가 설정되지 않았습니다';
    case 'error':
      return `실패 — ${reg.message}`;
  }
}
