/**
 * 생체 인증 — 기기 잠금 해제 (설계 §4.3 S1 · §5.3 주의 문단).
 *
 * **서버·DB 와 무관하다.** 지문·얼굴 대조는 기기 보안 칩(Android StrongBox / iOS Secure Enclave)
 * 안에서만 일어나고, 앱에 돌아오는 것은 `success: true|false` 뿐이다. 생체 데이터는 앱도,
 * 우리 백엔드도, Sentry 도 만지지 못한다. 그래서 DB 컬럼도 테이블도 늘지 않는다.
 *
 * 하는 일을 정확히 말하면 "서버에 재로그인"이 **아니라**, 이미 SecureStore 에 있는 JWT 를
 * 꺼내 쓰기 전에 거치는 **로컬 관문**이다. 인증에 성공해도 네트워크 요청은 한 건도 나가지 않는다.
 *
 * "사용 여부" 설정도 기기에만 둔다(§4.3 S1). 서버에 동기화하면 그 순간 이 기능이
 * 서버와 얽히고, 설계가 피하려던 것이 바로 그것이다.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

/** 토큰과 같은 저장소를 쓴다. 평문 AsyncStorage 는 쓰지 않는다(§7 ②). */
const ENABLED_KEY = 'ops.biometricLock';

/** 이 기기에서 생체 잠금을 쓸 수 있는가, 못 쓴다면 왜 못 쓰는가. */
export type BiometricCapability =
  | { status: 'ready'; label: string }
  /** 센서가 없는 기기(구형·에뮬레이터) */
  | { status: 'no-hardware' }
  /** 센서는 있는데 기기 설정에 지문·얼굴이 하나도 등록돼 있지 않다 */
  | { status: 'not-enrolled' };

/** 등록된 수단에 맞는 이름을 만든다. "생체 인증" 보다 "지문" 이 사용자에게 분명하다. */
function labelFor(types: LocalAuthentication.AuthenticationType[]): string {
  const names: string[] = [];
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) names.push('지문');
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) names.push('얼굴');
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) names.push('홍채');
  return names.length > 0 ? names.join('·') : '생체';
}

export async function getBiometricCapability(): Promise<BiometricCapability> {
  // 두 검사는 다른 질문이다. hasHardware = 센서가 달렸나, isEnrolled = 사용자가 등록했나.
  // 센서가 있어도 등록이 없으면 인증 창이 뜨자마자 실패하므로 토글을 보여주면 안 된다.
  const [hasHardware, isEnrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);

  if (!hasHardware) return { status: 'no-hardware' };
  if (!isEnrolled) return { status: 'not-enrolled' };
  return { status: 'ready', label: labelFor(types) };
}

export interface BiometricPromptResult {
  success: boolean;
  /** 실패 사유. 'user_cancel' 은 사용자가 스스로 닫은 것이라 에러로 다루지 않는다 */
  error?: string;
}

/**
 * 인증 창을 띄운다. 성공/실패만 돌려받는다.
 *
 * `disableDeviceFallback: false` — 지문을 여러 번 실패하면 OS 가 기기 PIN/패턴으로 넘겨준다.
 * 막지 않는 이유는, 손이 젖었거나 센서가 더러워 못 여는 상황에서 **온콜 담당자가 장애 알림을
 * 못 보는 것**이 더 큰 위험이기 때문이다. 어차피 여기서 지키는 것은 "이 폰을 집어든 남"이지
 * 기기 PIN 까지 아는 사람이 아니다.
 */
export async function promptBiometric(promptMessage: string): Promise<BiometricPromptResult> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: '취소',
    disableDeviceFallback: false,
  });

  return result.success ? { success: true } : { success: false, error: result.error };
}

/** 이 기기에서 잠금을 쓰기로 했는가. 저장소를 못 읽으면 "꺼짐"으로 본다 — 잠겨서 못 들어가는 것보다 낫다. */
export async function isBiometricLockEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(ENABLED_KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function setBiometricLockEnabled(enabled: boolean): Promise<void> {
  if (enabled) await SecureStore.setItemAsync(ENABLED_KEY, 'true');
  else await SecureStore.deleteItemAsync(ENABLED_KEY);
}
