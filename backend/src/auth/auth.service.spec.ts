import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserModel } from '../user/entity/user.entity';
import { RefreshTokenEntity } from './entity/refresh-token.entity';
import { RoleEntity, Role } from '../user/entity/role.entity';
import { RedisService } from '../intrastructure/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../intrastructure/emailVerify/email.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn(),
}));
import * as bcrypt from 'bcrypt';

// ─── Mock 팩토리 ───────────────────────────────────────────
const createMockRepository = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  exists: jest.fn(),
});

const createMockRedisService = () => ({
  checkRateLimit: jest.fn(),
  getLoginAttempts: jest.fn(),
  incrementLoginAttempts: jest.fn(),
  resetLoginAttempts: jest.fn(),
  getLoginAttemptsRemainingTime: jest.fn(),
  storeEmailVerificationToken: jest.fn(),
  getEmailVerificationUserId: jest.fn(),
  setEmailVerificationCooldown: jest.fn(),
  getEmailVerificationCooldown: jest.fn(),
  storeRefreshToken: jest.fn(),
  isRefreshTokenValid: jest.fn(),
  revokeRefreshToken: jest.fn(),
  revokeAllUserRefreshTokens: jest.fn(),
  addToBlacklist: jest.fn(),
  isBlacklisted: jest.fn(),
});

// ─── 공통 픽스처 ───────────────────────────────────────────
const mockContext = { ipAddress: '127.0.0.1', userAgent: 'jest-test' };

const mockBuyerRole: Partial<RoleEntity> = { id: 1, name: Role.BUYER };

const mockUser = {
  id: 1,
  email: 'test@example.com',
  password: 'hashed-password',
  nickName: 'testuser',
  phoneNumber: '01012345678',
  address: '서울시 강남구',
  isEmailVerified: true,
  roles: [mockBuyerRole],
};

// ─── 테스트 스위트 ─────────────────────────────────────────
describe('AuthService', () => {
  let service: AuthService;
  let usersRepository: ReturnType<typeof createMockRepository>;
  let refreshTokenRepository: ReturnType<typeof createMockRepository>;
  let roleRepository: ReturnType<typeof createMockRepository>;
  let jwtService: jest.Mocked<Pick<JwtService, 'sign' | 'verify' | 'decode'>>;
  let redisService: ReturnType<typeof createMockRedisService>;
  let auditService: { log: jest.Mock };
  let emailService: { sendVerificationEmail: jest.Mock };

  beforeEach(async () => {
    usersRepository = createMockRepository();
    refreshTokenRepository = createMockRepository();
    roleRepository = createMockRepository();
    redisService = createMockRedisService();
    // register/login/verifyEmail 모두 진입 직후 IP rate limit을 확인한다.
    // 기본값을 통과로 두지 않으면 undefined가 반환돼 모든 테스트가 429로 끝난다.
    redisService.checkRateLimit.mockResolvedValue(true);
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    emailService = { sendVerificationEmail: jest.fn().mockResolvedValue(undefined) };

    jwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
      verify: jest.fn(),
      decode: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(UserModel), useValue: usersRepository },
        { provide: getRepositoryToken(RefreshTokenEntity), useValue: refreshTokenRepository },
        { provide: getRepositoryToken(RoleEntity), useValue: roleRepository },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              const config: Record<string, string> = {
                JWT_SECRET: 'test-secret',
                JWT_REFRESH_SECRET: 'test-refresh-secret',
              };
              return config[key];
            }),
          },
        },
        { provide: RedisService, useValue: redisService },
        { provide: AuditService, useValue: auditService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // generateTokens 가 필요한 테스트에서 공통 설정
  const setupTokenMocks = () => {
    refreshTokenRepository.save.mockResolvedValue({});
    redisService.storeRefreshToken.mockResolvedValue(undefined);
  };

  // ─── register ────────────────────────────────────────────
  describe('register', () => {
    const dto = {
      email: 'new@example.com',
      password: 'Password1!',
      nickName: 'newuser',
      phoneNumber: '01012345678',
      address: '서울시',
    };

    it('성공: 유저 생성 + BUYER 역할 자동 부여', async () => {
      usersRepository.exists.mockResolvedValue(false);
      usersRepository.create.mockReturnValue({ ...dto });
      roleRepository.findOne.mockResolvedValue(mockBuyerRole);
      usersRepository.save.mockResolvedValue({ id: 1, ...dto });
      redisService.storeEmailVerificationToken.mockResolvedValue(undefined);
      redisService.setEmailVerificationCooldown.mockResolvedValue(undefined);

      const result = await service.register(dto, mockContext);

      expect(result.message).toContain('회원가입이 완료');
      // roles에 BUYER가 설정됐는지 확인
      const userPassedToSave = usersRepository.save.mock.calls[0][0];
      expect(userPassedToSave.roles).toContain(mockBuyerRole);
      expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(expect.any(String), expect.any(String));
    });

    it('실패: 이메일 중복 → BadRequestException', async () => {
      usersRepository.exists.mockResolvedValue(true);

      await expect(service.register(dto, mockContext)).rejects.toThrow(BadRequestException);
      expect(usersRepository.save).not.toHaveBeenCalled();
    });
  });

  // ─── login ───────────────────────────────────────────────
  describe('login', () => {
    const dto = { email: 'test@example.com', password: 'Password1!' };

    beforeEach(() => {
      redisService.checkRateLimit.mockResolvedValue(true);
      redisService.getLoginAttempts.mockResolvedValue(0);
      setupTokenMocks();
    });

    it('성공: accessToken / refreshToken / roles 반환', async () => {
      usersRepository.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      redisService.resetLoginAttempts.mockResolvedValue(undefined);

      const result = await service.login(dto, mockContext);

      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.refreshToken).toBe('mock-jwt-token');
      expect(result.user.roles).toContain(Role.BUYER);
    });

    it('실패: 존재하지 않는 유저 → UnauthorizedException', async () => {
      usersRepository.findOne.mockResolvedValue(null);

      await expect(service.login(dto, mockContext)).rejects.toThrow(UnauthorizedException);
      expect(redisService.incrementLoginAttempts).toHaveBeenCalled();
    });

    it('실패: 비밀번호 불일치 → UnauthorizedException', async () => {
      usersRepository.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto, mockContext)).rejects.toThrow(UnauthorizedException);
      expect(redisService.incrementLoginAttempts).toHaveBeenCalled();
    });

    it('실패: 이메일 미인증 → ForbiddenException', async () => {
      usersRepository.findOne.mockResolvedValue({ ...mockUser, isEmailVerified: false });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.login(dto, mockContext)).rejects.toThrow(ForbiddenException);
    });

    it('실패: IP Rate limit 초과 → HttpException 429', async () => {
      redisService.checkRateLimit.mockResolvedValue(false);

      await expect(service.login(dto, mockContext)).rejects.toThrow(HttpException);
    });

    it('실패: 계정 잠금 (5회 초과) → HttpException 429', async () => {
      redisService.getLoginAttempts.mockResolvedValue(5);
      redisService.getLoginAttemptsRemainingTime.mockResolvedValue(600);

      await expect(service.login(dto, mockContext)).rejects.toThrow(HttpException);
    });
  });

  // ─── verifyEmail ─────────────────────────────────────────
  describe('verifyEmail', () => {
    it('성공: isEmailVerified = true 저장 + 토큰 반환', async () => {
      const unverifiedUser = { ...mockUser, isEmailVerified: false };
      redisService.getEmailVerificationUserId.mockResolvedValue(1);
      usersRepository.findOne.mockResolvedValue(unverifiedUser);
      usersRepository.save.mockResolvedValue({ ...unverifiedUser, isEmailVerified: true });
      setupTokenMocks();

      const result = await service.verifyEmail('valid-token', mockContext);

      expect(result.accessToken).toBeDefined();
      expect(usersRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ isEmailVerified: true }),
      );
    });

    it('실패: Redis에 토큰 없음 → BadRequestException', async () => {
      redisService.getEmailVerificationUserId.mockResolvedValue(null);

      await expect(service.verifyEmail('bad-token', mockContext)).rejects.toThrow(BadRequestException);
    });

    it('실패: 유저 없음 → BadRequestException', async () => {
      redisService.getEmailVerificationUserId.mockResolvedValue(999);
      usersRepository.findOne.mockResolvedValue(null);

      await expect(service.verifyEmail('valid-token', mockContext)).rejects.toThrow(BadRequestException);
    });
  });

  // ─── refresh ─────────────────────────────────────────────
  describe('refresh', () => {
    const mockRefreshPayload = {
      sub: 1,
      email: 'test@example.com',
      type: 'refresh',
      tokenId: 'test-token-uuid',
    };

    beforeEach(() => {
      setupTokenMocks();
    });

    it('성공: 새 토큰 쌍 반환', async () => {
      const storedToken = {
        id: 'test-token-uuid',
        userId: 1,
        tokenHash: 'mock-hash',
        isRevoked: false,
        isPersistent: false,
      };

      (jwtService.verify as jest.Mock).mockReturnValue(mockRefreshPayload);
      redisService.isRefreshTokenValid.mockResolvedValue(true);
      refreshTokenRepository.findOne.mockResolvedValue(storedToken);
      jest.spyOn(service as any, 'hashToken').mockReturnValue('mock-hash');
      usersRepository.findOne.mockResolvedValue(mockUser);
      refreshTokenRepository.update.mockResolvedValue({});
      redisService.revokeRefreshToken.mockResolvedValue(undefined);

      const result = await service.refresh('some-refresh-token', mockContext);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('실패: verify 실패 → UnauthorizedException', async () => {
      (jwtService.verify as jest.Mock).mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.refresh('expired-token', mockContext)).rejects.toThrow(UnauthorizedException);
    });

    it('실패: Redis에 토큰 없음 → UnauthorizedException', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue(mockRefreshPayload);
      redisService.isRefreshTokenValid.mockResolvedValue(false);

      await expect(service.refresh('revoked-token', mockContext)).rejects.toThrow(UnauthorizedException);
    });

    it('실패: 토큰 재사용 감지 → 전체 세션 무효화 후 UnauthorizedException', async () => {
      const revokedToken = {
        id: 'test-token-uuid',
        userId: 1,
        tokenHash: 'mock-hash',
        isRevoked: true,
      };

      (jwtService.verify as jest.Mock).mockReturnValue(mockRefreshPayload);
      redisService.isRefreshTokenValid.mockResolvedValue(true);
      refreshTokenRepository.findOne.mockResolvedValue(revokedToken);
      refreshTokenRepository.update.mockResolvedValue({});
      redisService.revokeAllUserRefreshTokens.mockResolvedValue(undefined);

      await expect(service.refresh('reused-token', mockContext)).rejects.toThrow(UnauthorizedException);
      // 전체 세션 무효화 호출됐는지 확인
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: 1, isRevoked: false },
        expect.objectContaining({ isRevoked: true }),
      );
    });
  });

  // ─── logout ──────────────────────────────────────────────
  describe('logout', () => {
    it('성공: 블랙리스트 등록 + refresh 토큰 무효화', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 900;
      (jwtService.decode as jest.Mock).mockReturnValue({ exp: futureExp });
      redisService.addToBlacklist.mockResolvedValue(undefined);
      (jwtService.verify as jest.Mock).mockReturnValue({ tokenId: 'uuid', type: 'refresh' });
      refreshTokenRepository.update.mockResolvedValue({});
      redisService.revokeRefreshToken.mockResolvedValue(undefined);

      const result = await service.logout(1, 'access-token', 'refresh-token', mockContext);

      expect(result.message).toContain('로그아웃');
      expect(redisService.addToBlacklist).toHaveBeenCalledWith('access-token', expect.any(Number));
    });
  });

  // ─── checkEmailDuplicate ─────────────────────────────────
  describe('checkEmailDuplicate', () => {
    beforeEach(() => {
      redisService.checkRateLimit.mockResolvedValue(true);
    });

    it('사용 가능한 이메일 → available: true', async () => {
      usersRepository.exists.mockResolvedValue(false);
      const result = await service.checkEmailDuplicate('new@example.com', '127.0.0.1');
      expect(result.available).toBe(true);
    });

    it('중복 이메일 → available: false', async () => {
      usersRepository.exists.mockResolvedValue(true);
      const result = await service.checkEmailDuplicate('dup@example.com', '127.0.0.1');
      expect(result.available).toBe(false);
    });

    it('Rate limit 초과 → HttpException 429', async () => {
      redisService.checkRateLimit.mockResolvedValue(false);
      await expect(service.checkEmailDuplicate('x@x.com', '127.0.0.1')).rejects.toThrow(HttpException);
    });
  });

  // ─── checkNicknameDuplicate ──────────────────────────────
  describe('checkNicknameDuplicate', () => {
    beforeEach(() => {
      redisService.checkRateLimit.mockResolvedValue(true);
    });

    it('사용 가능한 닉네임 → available: true', async () => {
      usersRepository.exists.mockResolvedValue(false);
      const result = await service.checkNicknameDuplicate('newNick', '127.0.0.1');
      expect(result.available).toBe(true);
    });

    it('중복 닉네임 → available: false', async () => {
      usersRepository.exists.mockResolvedValue(true);
      const result = await service.checkNicknameDuplicate('dupNick', '127.0.0.1');
      expect(result.available).toBe(false);
    });
  });
});
