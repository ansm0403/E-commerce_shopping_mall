import { BadRequestException } from '@nestjs/common';
import { DEMO_ROLES, DemoRole } from '../../demo/demo-policy.service';

/** Object-typed @Body avoids the global pipe's implicit string conversion. */
export function parseDemoRole(body: unknown): DemoRole {
  if (body === undefined) return 'admin';
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => k !== 'role')
  )
    throw new BadRequestException('체험 역할 요청이 올바르지 않습니다.');
  const role = (body as { role?: unknown }).role;
  if (role === undefined) return 'admin';
  if (typeof role !== 'string' || !DEMO_ROLES.includes(role as DemoRole))
    throw new BadRequestException('체험 역할을 선택하세요.');
  return role as DemoRole;
}
