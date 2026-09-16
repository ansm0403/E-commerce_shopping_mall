import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * 컨트롤러 단위 테스트 — 서비스는 전부 mock.
 *
 * 여기서 고정하는 것은 "X-Client: mobile 헤더 분기"(ops-companion-design §5.6)다.
 *  · 헤더 없음(웹)  : 응답 body 에 refreshToken 이 없고, 쿠키로만 내려간다 — 기존 동작 불변.
 *  · 헤더 mobile    : body 에 refreshToken 이 추가된다. 쿠키도 그대로 설정된다.
 *  · refresh        : 쿠키 ?? body 순서. 둘 다 없으면 401.
 */
const tokenResult = {
  accessToken: 'access.jwt',
  refreshToken: 'refresh.jwt',
  expiresIn: 900,
  tokenType: 'Bearer',
  user: { id: 42, email: 'kim@test.local', nickName: '김쇼핑', roles: ['buyer'], isDemo: false },
  isPersistent: false,
};

const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest', deviceId: undefined };

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<Pick<AuthService, 'login' | 'refresh' | 'logout'>>;
  let res: jest.Mocked<Pick<Response, 'cookie' | 'clearCookie'>>;

  beforeEach(async () => {
    authService = {
      login: jest.fn().mockResolvedValue(tokenResult),
      refresh: jest.fn().mockResolvedValue({ ...tokenResult, accessToken: 'access.jwt.2', refreshToken: 'refresh.jwt.2' }),
      logout: jest.fn().mockResolvedValue({ message: '로그아웃 되었습니다.' }),
    };
    res = { cookie: jest.fn(), clearCookie: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    const body = { email: 'kim@test.local', password: 'Test1234!' };

    it('헤더 없음(웹): body 에 refreshToken 이 없고 쿠키로만 설정된다', async () => {
      const out = await controller.login(res as unknown as Response, body, ctx.ipAddress, ctx.userAgent, undefined, undefined);

      expect(out).toEqual({
        accessToken: 'access.jwt',
        expiresIn: 900,
        tokenType: 'Bearer',
        user: tokenResult.user,
      });
      expect(out).not.toHaveProperty('refreshToken');
      expect(res.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'refresh.jwt',
        expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
      );
    });

    it('X-Client: mobile — body 에 refreshToken 이 추가되고 쿠키도 그대로 설정된다', async () => {
      const out = await controller.login(res as unknown as Response, body, ctx.ipAddress, ctx.userAgent, undefined, 'mobile');

      expect(out).toMatchObject({ accessToken: 'access.jwt', refreshToken: 'refresh.jwt' });
      expect(res.cookie).toHaveBeenCalledTimes(1);
    });

    it('X-Client 가 mobile 이 아닌 값이면 웹과 동일하게 처리한다', async () => {
      const out = await controller.login(res as unknown as Response, body, ctx.ipAddress, ctx.userAgent, undefined, 'web');
      expect(out).not.toHaveProperty('refreshToken');
    });
  });

  describe('refresh', () => {
    const reqWith = (cookies?: Record<string, string>) => ({ cookies } as unknown as Request);

    it('쿠키의 refreshToken 으로 갱신하고 body 에는 refreshToken 을 내리지 않는다(웹)', async () => {
      const out = await controller.refresh(reqWith({ refreshToken: 'from-cookie' }), res as unknown as Response, ctx.ipAddress, {}, ctx.userAgent);

      expect(authService.refresh).toHaveBeenCalledWith('from-cookie', expect.objectContaining({ ipAddress: ctx.ipAddress }));
      expect(out).toMatchObject({ accessToken: 'access.jwt.2' });
      expect(out).not.toHaveProperty('refreshToken');
      expect(res.cookie).toHaveBeenCalledWith('refreshToken', 'refresh.jwt.2', expect.any(Object));
    });

    it('쿠키가 없으면 body.refreshToken 을 쓴다 + mobile 헤더면 새 refreshToken 을 body 로 돌려준다', async () => {
      const out = await controller.refresh(reqWith(undefined), res as unknown as Response, ctx.ipAddress, { refreshToken: 'from-body' }, ctx.userAgent, undefined, 'mobile');

      expect(authService.refresh).toHaveBeenCalledWith('from-body', expect.anything());
      expect(out).toMatchObject({ accessToken: 'access.jwt.2', refreshToken: 'refresh.jwt.2' });
    });

    it('쿠키가 있으면 body 보다 쿠키를 우선한다', async () => {
      await controller.refresh(reqWith({ refreshToken: 'from-cookie' }), res as unknown as Response, ctx.ipAddress, { refreshToken: 'from-body' });
      expect(authService.refresh).toHaveBeenCalledWith('from-cookie', expect.anything());
    });

    it('쿠키도 body 도 없으면 401', async () => {
      await expect(
        controller.refresh(reqWith(undefined), res as unknown as Response, ctx.ipAddress, {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(authService.refresh).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('쿠키가 없으면 body.refreshToken 을 서버 무효화에 사용한다(모바일)', async () => {
      const req = { cookies: undefined, headers: { authorization: 'Bearer access.jwt' } } as unknown as Request;
      await controller.logout(req, res as unknown as Response, 42, ctx.ipAddress, { refreshToken: 'from-body' });

      expect(authService.logout).toHaveBeenCalledWith(42, 'access.jwt', 'from-body', expect.anything());
      expect(res.clearCookie).toHaveBeenCalledWith('refreshToken', expect.any(Object));
    });
  });
});
