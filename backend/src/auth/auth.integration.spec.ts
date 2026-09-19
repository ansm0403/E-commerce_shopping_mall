/**
 * Auth 통합 테스트
 *
 * 사전 조건:
 *   1. Docker PostgreSQL이 실행 중이어야 합니다.
 *   2. 테스트 DB 생성:
 *      docker exec -it <postgres-container> psql -U sangmoon -c "CREATE DATABASE shopping_mall_test;"
 *   3. 루트에 .env.test 파일이 있어야 합니다.
 *
 * 실행: nx test backend --testFile=auth.integration.spec.ts
 */
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { UserModel } from '../user/entity/user.entity';
import { RefreshTokenEntity } from './entity/refresh-token.entity';
import { RoleEntity, Role } from '../user/entity/role.entity';
import { AuditLogEntity } from '../audit/entity/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../intrastructure/redis/redis.service';
import { EmailService } from '../intrastructure/emailVerify/email.service';

// ─── 외부 인프라 Mock (Redis, Email) ──────────────────────
const mockRedisService = {
  checkRateLimit: jest.fn().mockResolvedValue(true),
  getLoginAttempts: jest.fn().mockResolvedValue(0),
  incrementLoginAttempts: jest.fn().mockResolvedValue(undefined),
  resetLoginAttempts: jest.fn().mockResolvedValue(undefined),
  getLoginAttemptsRemainingTime: jest.fn().mockResolvedValue(0),
  storeEmailVerificationToken: jest.fn().mockResolvedValue(undefined),
  getEmailVerificationUserId: jest.fn(),
  setEmailVerificationCooldown: jest.fn().mockResolvedValue(undefined),
  getEmailVerificationCooldown: jest.fn().mockResolvedValue(0),
  storeRefreshToken: jest.fn().mockResolvedValue(undefined),
  isRefreshTokenValid: jest.fn().mockResolvedValue(true),
  revokeRefreshToken: jest.fn().mockResolvedValue(undefined),
  revokeAllUserRefreshTokens: jest.fn().mockResolvedValue(undefined),
  addToBlacklist: jest.fn().mockResolvedValue(undefined),
  isBlacklisted: jest.fn().mockResolvedValue(false),
};

const mockEmailService = {
  sendVerificationEmail: jest.fn().mockResolvedValue({ success: true }),
};

describe('Auth Integration Tests', () => {
  let module: TestingModule;
  let authService: AuthService;
  let userRepository: Repository<UserModel>;
  let roleRepository: Repository<RoleEntity>;
  let refreshTokenRepository: Repository<RefreshTokenEntity>;
  let dataSource: DataSource;

  const mockContext = { ipAddress: '127.0.0.1', userAgent: 'jest-integration' };

  const registerDto = {
    email: 'integration@example.com',
    password: 'Password1!',
    nickName: 'integrationUser',
    phoneNumber: '01012345678',
    address: '서울시 강남구',
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ envFilePath: '.env.test', isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.POSTGRES_HOST || 'localhost',
          port: Number(process.env.POSTGRES_PORT) || 4321,
          username: process.env.POSTGRES_USER || 'sangmoon',
          password: process.env.POSTGRES_PASSWORD || 'postgres',
          database: process.env.TEST_POSTGRES_DB || 'shopping_mall_test',
          entities: [UserModel, RefreshTokenEntity, RoleEntity, AuditLogEntity],
          synchronize: true,
          dropSchema: true, // 테스트 시작 시 스키마 초기화
        }),
        TypeOrmModule.forFeature([UserModel, RefreshTokenEntity, RoleEntity, AuditLogEntity]),
        JwtModule.register({
          secret: 'test-jwt-secret',
          signOptions: { expiresIn: '15m' },
        }),
      ],
      providers: [
        AuthService,
        AuditService,
        { provide: RedisService, useValue: mockRedisService },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    await module.init(); // onApplicationBootstrap 실행

    authService = module.get<AuthService>(AuthService);
    userRepository = module.get(getRepositoryToken(UserModel));
    roleRepository = module.get(getRepositoryToken(RoleEntity));
    refreshTokenRepository = module.get(getRepositoryToken(RefreshTokenEntity));
    dataSource = module.get(DataSource);

    // roles 테이블 seed (RolesSeedService 대신 직접)
    for (const name of Object.values(Role)) {
      const exists = await roleRepository.findOne({ where: { name } });
      if (!exists) {
        await roleRepository.save(roleRepository.create({ name }));
      }
    }
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  afterEach(async () => {
    // 각 테스트 후 데이터 정리 (roles는 유지)
    await dataSource.query('DELETE FROM refresh_tokens');
    await dataSource.query('DELETE FROM user_roles');
    await dataSource.query('DELETE FROM users');
    await dataSource.query('DELETE FROM audit_logs');
    jest.clearAllMocks();
  });

  // ─── register ──────────────────────────────────────────
  describe('register', () => {
    it('성공: DB에 유저 저장 + user_roles에 BUYER 역할 부여', async () => {
      await authService.register(registerDto, mockContext);

      const user = await userRepository.findOne({
        where: { email: registerDto.email },
        relations: ['roles'],
      });

      expect(user).toBeDefined();
      expect(user.email).toBe(registerDto.email);
      expect(user.isEmailVerified).toBe(false);
      expect(user.roles.map((r) => r.name)).toContain(Role.BUYER);
      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalled();
    });

    it('성공: 비밀번호가 해시로 저장됨 (평문 아님)', async () => {
      await authService.register(registerDto, mockContext);

      const user = await userRepository.findOne({ where: { email: registerDto.email } });
      const isHashed = await bcrypt.compare(registerDto.password, user.password);

      expect(user.password).not.toBe(registerDto.password);
      expect(isHashed).toBe(true);
    });

    it('실패: 이메일 중복 → BadRequestException + DB에 중복 저장 안 됨', async () => {
      await authService.register(registerDto, mockContext);

      await expect(authService.register(registerDto, mockContext)).rejects.toThrow();

      const count = await userRepository.count({ where: { email: registerDto.email } });
      expect(count).toBe(1);
    });
  });

  // ─── verifyEmail + login 플로우 ────────────────────────
  describe('verifyEmail → login 플로우', () => {
    let verificationToken: string;

    beforeEach(async () => {
      // 토큰 캡처를 위해 storeEmailVerificationToken mock 재설정
      mockRedisService.storeEmailVerificationToken.mockImplementation(
        async (_userId: number, token: string) => {
          verificationToken = token;
        },
      );

      await authService.register(registerDto, mockContext);
    });

    it('이메일 인증 후 isEmailVerified = true 로 DB 저장', async () => {
      const user = await userRepository.findOne({ where: { email: registerDto.email } });
      mockRedisService.getEmailVerificationUserId.mockResolvedValue(user.id);

      await authService.verifyEmail(verificationToken, mockContext);

      const verified = await userRepository.findOne({ where: { id: user.id } });
      expect(verified.isEmailVerified).toBe(true);
    });

    it('인증 완료 후 login 성공 → refresh_tokens 테이블에 저장', async () => {
      const user = await userRepository.findOne({ where: { email: registerDto.email } });
      mockRedisService.getEmailVerificationUserId.mockResolvedValue(user.id);

      await authService.verifyEmail(verificationToken, mockContext);
      await authService.login(
        { email: registerDto.email, password: registerDto.password },
        mockContext,
      );

      const tokens = await refreshTokenRepository.find({ where: { userId: user.id } });
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens[0].isRevoked).toBe(false);
    });

    it('미인증 상태에서 login 시도 → ForbiddenException', async () => {
      const { ForbiddenException } = await import('@nestjs/common');

      await expect(
        authService.login(
          { email: registerDto.email, password: registerDto.password },
          mockContext,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── logout ────────────────────────────────────────────
  describe('logout', () => {
    it('logout 후 refresh_token isRevoked = true', async () => {
      // 유저 생성 + 인증
      let capturedToken = '';
      mockRedisService.storeEmailVerificationToken.mockImplementation(
        async (_id: number, token: string) => { capturedToken = token; },
      );
      await authService.register(registerDto, mockContext);

      const user = await userRepository.findOne({ where: { email: registerDto.email } });
      mockRedisService.getEmailVerificationUserId.mockResolvedValue(user.id);
      await authService.verifyEmail(capturedToken, mockContext);

      const loginResult = await authService.login(
        { email: registerDto.email, password: registerDto.password },
        mockContext,
      );

      await authService.logout(user.id, loginResult.accessToken, loginResult.refreshToken, mockContext);

      const tokens = await refreshTokenRepository.find({ where: { userId: user.id } });
      expect(tokens.every((t) => t.isRevoked)).toBe(true);
    });
  });
});
