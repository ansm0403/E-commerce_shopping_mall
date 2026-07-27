import { authStorage } from '../service/auth-storage';

/**
 * 액세스 토큰 payload 읽기 (서명 검증 없음).
 *
 * ⚠ 이건 인가 판단이 아니다. 인가는 전적으로 백엔드 몫이고(JwtAuthGuard + RolesGuard),
 * 여기서 읽는 건 "내가 지금 들고 있는 토큰이 최신인가"를 UI가 알기 위한 용도다.
 *
 * 왜 필요한가 — 인가는 토큰에 박힌 역할 기준인데(00-role-audit §1), 관리자가 셀러를 승인하면
 * DB의 user.roles 만 바뀐다. 이미 발급된 액세스 토큰에는 여전히 buyer 뿐이라
 * `/auth/me`(DB 조회)는 seller 인데 셀러 API 는 403 이 나는 어긋남이 생긴다.
 * 그 어긋남을 화면에서 감지해 refresh 를 한 번 태우려고 토큰 payload 를 직접 본다.
 */

export interface AccessTokenPayload {
  sub: number;
  email: string;
  type: 'access' | 'refresh';
  roles?: string[];
  isDemo?: boolean;
  exp?: number;
  iat?: number;
}

/** base64url → JSON. 형식이 깨졌으면 null (호출부는 "모름"으로 취급). */
export function decodeJwtPayload(token: string): AccessTokenPayload | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;

    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    // atob 는 latin1 을 주므로 UTF-8(한글 닉네임 등) 복원을 위해 퍼센트 인코딩을 거친다.
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    );
    return JSON.parse(json) as AccessTokenPayload;
  } catch {
    return null;
  }
}

/** 현재 저장된 액세스 토큰의 roles. 토큰이 없거나 못 읽으면 null(=판단 불가). */
export function getTokenRoles(): string[] | null {
  const token = authStorage.getAccessToken();
  if (!token) return null;
  return decodeJwtPayload(token)?.roles ?? null;
}

/** 현재 토큰에 해당 역할이 박혀 있는가. 판단 불가면 false. */
export function tokenHasRole(role: string): boolean {
  return getTokenRoles()?.includes(role) ?? false;
}
