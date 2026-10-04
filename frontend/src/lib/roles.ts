/**
 * 역할 판정 — UI 분기용(실제 권한은 백엔드 RolesGuard 가 판정한다).
 *
 * roles 가 두 모양으로 온다: shared 타입은 `string[]` 인데 `/auth/me` 런타임 값은 `[{ name: 'admin' }]`.
 * 그 차이를 여기서 흡수한다.
 */
export type RoleName = 'buyer' | 'seller' | 'admin';

export function hasRole(user: { roles?: unknown } | null | undefined, role: RoleName): boolean {
  const roles = user?.roles;
  if (!Array.isArray(roles)) return false;
  return (roles as Array<string | { name?: string } | null>).some(
    (r) => (typeof r === 'string' ? r : r?.name) === role,
  );
}
