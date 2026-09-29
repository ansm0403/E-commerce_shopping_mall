/**
 * 생체 인증 — 웹 체험판 전용(iOS·안드로이드는 biometrics.ts).
 *
 * 브라우저에는 지문·얼굴로 "앱 잠금"을 거는 수단이 없다. 그래서 항상 "지원하지 않음"을 돌려주고,
 * 잠금 설정도 꺼진 것으로 본다 → 프로필의 토글이 비활성으로 그려지고, 잠금 덮개는 뜨지 않는다.
 * 저장소(SecureStore)도 웹에는 없으므로 설정을 읽거나 쓰지 않는다.
 */
import type { BiometricCapability, BiometricPromptResult } from './biometrics';

export type { BiometricCapability, BiometricPromptResult };

export async function getBiometricCapability(): Promise<BiometricCapability> {
  return { status: 'no-hardware' };
}

export async function promptBiometric(_promptMessage: string): Promise<BiometricPromptResult> {
  return { success: false, error: 'not_available' };
}

export async function isBiometricLockEnabled(): Promise<boolean> {
  return false;
}

export async function setBiometricLockEnabled(_enabled: boolean): Promise<void> {
  // 웹에서는 토글이 비활성이라 불리지 않는다.
}
