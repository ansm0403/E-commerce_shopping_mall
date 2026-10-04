import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import { AuthService } from '../auth.service';

describe('OptionalJwtAuthGuard', () => {
  let guard: OptionalJwtAuthGuard;
  let authService: jest.Mocked<Pick<AuthService, 'verifyAccessToken'>>;

  beforeEach(() => {
    authService = { verifyAccessToken: jest.fn() } as any;
    guard = new OptionalJwtAuthGuard(authService as any);
  });

  const createMockContext = (authHeader?: string) => {
    const request: Record<string, any> = {
      headers: authHeader ? { authorization: authHeader } : {},
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  };

  it('유효한 Bearer 토큰 → 통과, request.user 설정', async () => {
    const mockPayload = { sub: 1, email: 'test@example.com', roles: ['buyer'] };
    authService.verifyAccessToken.mockResolvedValue(mockPayload as any);

    const ctx = createMockContext('Bearer valid-token');
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(ctx.switchToHttp().getRequest().user).toEqual(mockPayload);
    expect(authService.verifyAccessToken).toHaveBeenCalledWith('valid-token');
  });

  it('Authorization 헤더 없음 → 통과, request.user 없음(검증 호출도 없음)', async () => {
    const ctx = createMockContext();
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(ctx.switchToHttp().getRequest().user).toBeUndefined();
    expect(authService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('만료/무효 토큰 → 401 이 아니라 비로그인으로 통과', async () => {
    authService.verifyAccessToken.mockRejectedValue(new UnauthorizedException());

    const ctx = createMockContext('Bearer expired-token');
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(ctx.switchToHttp().getRequest().user).toBeUndefined();
  });
});
