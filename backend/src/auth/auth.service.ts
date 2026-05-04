import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { RefreshTokenEntity } from './entity/refresh-token.entity';
import { AuditAction } from '../audit/entity/audit-log.entity';
import { RedisService } from '../intrastructure/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { UserModel } from '../user/entity/user.entity';
import { RoleEntity, Role } from '../user/entity/role.entity';
import { RegisterDto } from './dto/register.dto';
import { EmailService } from '../intrastructure/emailVerify/email.service';

interface JwtPayload {
  sub: number;
  email: string;
  roles?: Role[];
  type: 'access' | 'refresh';
  tokenId?: string;
  isDemo?: boolean;
}

interface LoginContext {
  ipAddress: string;
  userAgent?: string;
  deviceId?: string;
}

@Injectable()
export class AuthService {
  private readonly ACCESS_TOKEN_EXPIRATION = 900; // 15분
  private readonly REFRESH_TOKEN_EXPIRATION = 604800; // 7일
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOGIN_LOCKOUT_DURATION = 900; // 15분

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly auditLogService: AuditService,
    private readonly emailService: EmailService,
    @InjectRepository(UserModel)
    private readonly usersRepository: Repository<UserModel>,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokenRepository: Repository<RefreshTokenEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
  ) {}

  async getMe(id: number) {
    const user = await this.usersRepository.findOne({
      where: { id },
      relations: ['roles'],
    });

    if (!user) {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
    }

    const { password, ...result } = user;
    return result;
  }

  // ===== 회원가입 =====
  async register(
    dto: RegisterDto,
    context: LoginContext,
  ) {
    // Rate Limiting: IP당 1분에 3회 제한 (봇 가짜 계정 양산 방지)
    const canAttempt = await this.redisService.checkRateLimit(
      `register:${context.ipAddress}`,
      3,
      60,
    );

    if (!canAttempt) {
      throw new HttpException(
        '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 이메일 중복 확인
    const emailExists = await this.usersRepository.exists({
      where: { email: dto.email },
    });

    if (emailExists) {
      throw new BadRequestException('이미 사용 중인 이메일입니다.');
    }

    // 비밀번호 해싱
    const hashedPassword = await bcrypt.hash(dto.password, 12);

    // 사용자 생성
    const user = this.usersRepository.create({
      email: dto.email,
      nickName: dto.nickName,
      password: hashedPassword,
      phoneNumber: dto.phoneNumber,
      address: dto.address,
    });

    const buyerRole = await this.roleRepository.findOne({ where: { name: Role.BUYER } });
    user.roles = buyerRole ? [buyerRole] : [];

    const savedUser = await this.usersRepository.save(user);

    // 이메일 인증 토큰 생성
    const verificationToken = this.generateSecureToken();
    await this.redisService.storeEmailVerificationToken(
      savedUser.id,
      verificationToken,
      3600, // 1시간
    );

    // 감사 로그
    await this.auditLogService.log({
      userId: savedUser.id,
      action: AuditAction.REGISTER,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    

    // 이메일 인증 메일 전송
    await this.emailService.sendVerificationEmail(
      savedUser.email,
      verificationToken,
    );

    // 재발송 쿨다운 설정 (3분)
    await this.redisService.setEmailVerificationCooldown(savedUser.id);

    return {
      message: '회원가입이 완료되었습니다. 이메일을 확인해주세요.',
    };
  }

  // ===== 이메일 인증 =====
  async verifyEmail(token: string, context: LoginContext) {
    // Rate Limiting: IP당 1분에 10회 제한 (토큰 brute force 방지)
    const canAttempt = await this.redisService.checkRateLimit(
      `verify-email:${context.ipAddress}`,
      10,
      60,
    );

    if (!canAttempt) {
      throw new HttpException(
        '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const userId = await this.redisService.getEmailVerificationUserId(token);

    if (!userId) {
      throw new BadRequestException('유효하지 않거나 만료된 인증 토큰입니다.');
    }

    await this.auditLogService.log({
      userId,
      action: AuditAction.EMAIL_VERIFIED,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const user = await this.usersRepository.findOne({
      where: { id: userId },
      relations: ['roles'],
    });

    if (!user) {
      throw new BadRequestException('사용자를 찾을 수 없습니다.');
    }

    // 이메일 인증 완료 처리
    user.isEmailVerified = true;
    await this.usersRepository.save(user);

    return this.generateTokens(user, context, false);
  }

  // ===== 로그인 =====
  async login(
    dto: { email: string; password: string, rememberMe?: boolean },
    context: LoginContext,
  ) {
    // Rate Limiting 체크
    const canAttempt = await this.redisService.checkRateLimit(
      `login:${context.ipAddress}`,
      10, // IP당 10회`
      300, // 5분
    );

    if (!canAttempt) {
      throw new HttpException(
        '너무 많은 로그인 시도입니다. 잠시 후 다시 시도해주세요.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 로그인 시도 횟수 확인
    const attempts = await this.redisService.getLoginAttempts(dto.email);

    if (attempts >= this.MAX_LOGIN_ATTEMPTS) {
      const remainingTime = await this.redisService.getLoginAttemptsRemainingTime(dto.email);

      await this.auditLogService.log({
        action: AuditAction.ACCOUNT_LOCKED,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { email: dto.email },
        success: false,
      });

      throw new HttpException(
        `계정이 잠겼습니다. ${Math.ceil(remainingTime / 60)}분 후 다시 시도해주세요.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 사용자 조회
    const user = await this.usersRepository.findOne({
      where: { email: dto.email },
      relations: ['roles'],
    });

    if (!user) {
      await this.redisService.incrementLoginAttempts(dto.email);

      await this.auditLogService.log({
        action: AuditAction.FAILED_LOGIN,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { email: dto.email, reason: 'user_not_found' },
        success: false,
      });

      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    // 비밀번호 검증
    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      await this.redisService.incrementLoginAttempts(dto.email);

      await this.auditLogService.log({
        userId: user.id,
        action: AuditAction.FAILED_LOGIN,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { reason: 'invalid_password' },
        success: false,
      });

      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    // 이메일 인증 여부 확인
    if (!user.isEmailVerified) {
      throw new ForbiddenException(
        '이메일 인증이 완료되지 않았습니다. 이메일을 확인하거나 인증 메일을 재발송해주세요.',
      );
    }

    // 로그인 성공 - 시도 횟수 초기화
    await this.redisService.resetLoginAttempts(dto.email);

    await this.auditLogService.log({
      userId: user.id,
      action: AuditAction.LOGIN,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { deviceId: context.deviceId },
    });

    const rememberMe = !!dto.rememberMe;

    return this.generateTokens(user, context, rememberMe);
  }

  // ===== 데모 관리자 로그인 =====
  async demoLogin(context: LoginContext) {
    const enabled = this.configService.get<string>('DEMO_LOGIN_ENABLED');
    if (enabled !== 'true') {
      throw new ForbiddenException('데모 로그인이 비활성화되어 있습니다.');
    }

    const email = this.configService.get<string>('DEMO_ADMIN_EMAIL');
    const password = this.configService.get<string>('DEMO_ADMIN_PASSWORD');

    if (!email || !password) {
      throw new ForbiddenException('데모 관리자 계정이 설정되지 않았습니다.');
    }

    return this.login({ email, password, rememberMe: false }, context);
  }

  // ===== 토큰 생성 =====
  private async generateTokens(user: UserModel, context: LoginContext, isPersistent: boolean) {
    const tokenId = crypto.randomUUID();

    // Access Token
    const accessPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      type: 'access',
      roles: user.roles?.map((r) => r.name) ?? [],
      isDemo: user.isDemo ?? false,
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: this.ACCESS_TOKEN_EXPIRATION,
    });

    // Refresh Token
    const refreshPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      type: 'refresh',
      tokenId,
    };

    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: this.configService.get('JWT_REFRESH_SECRET'),
      expiresIn: this.REFRESH_TOKEN_EXPIRATION,
    });

    // Refresh Token DB 저장
    const refreshTokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + this.REFRESH_TOKEN_EXPIRATION * 1000);

    await this.refreshTokenRepository.save({
      id: tokenId,
      userId: user.id,
      tokenHash: refreshTokenHash,
      expiresAt,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
      deviceId: context.deviceId,
      isPersistent,
    });

    // Redis에도 저장 (빠른 검증용)
    await this.redisService.storeRefreshToken(
      user.id,
      tokenId,
      this.REFRESH_TOKEN_EXPIRATION,
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: this.ACCESS_TOKEN_EXPIRATION,
      tokenType: 'Bearer',
      user: {
        id: user.id,
        email: user.email,
        nickName: user.nickName,
        roles: user.roles?.map((r) => r.name) ?? [],
        isDemo: user.isDemo ?? false,
      },
      isPersistent,
    };
  }

  // ===== 토큰 갱신 =====
  async refresh(refreshToken: string, context: LoginContext) {
    let payload: JwtPayload;

    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });
    } catch (error) {
      throw new UnauthorizedException('유효하지 않은 Refresh Token입니다.');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Refresh Token이 아닙니다.');
    }

    if (!payload.tokenId) {
      throw new UnauthorizedException('유효하지 않은 Refresh Token 형식입니다.');
    }

    // Redis에서 유효성 확인 (빠른 검증)
    const isValid = await this.redisService.isRefreshTokenValid(
      payload.sub,
      payload.tokenId,
    );

    if (!isValid) {
      throw new UnauthorizedException('만료되거나 무효화된 토큰입니다.');
    }

    // DB에서 확인 (정확한 검증)
    const storedToken = await this.refreshTokenRepository.findOne({
      where: { id: payload.tokenId, userId: payload.sub },
    });

    if (!storedToken || storedToken.isRevoked) {
      // 토큰 재사용 시도 감지 - 모든 세션 무효화
      await this.revokeAllUserTokens(payload.sub);

      await this.auditLogService.log({
        userId: payload.sub,
        action: AuditAction.TOKEN_REFRESH,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { reason: 'token_reuse_detected' },
        success: false,
        errorMessage: '토큰 재사용 감지 - 모든 세션 무효화',
      });

      throw new UnauthorizedException('보안 위반이 감지되었습니다. 다시 로그인해주세요.');
    }

    // 토큰 해시 검증
    const tokenHash = this.hashToken(refreshToken);
    if (storedToken.tokenHash !== tokenHash) {
      throw new UnauthorizedException('유효하지 않은 토큰입니다.');
    }

    // 사용자 조회
    const user = await this.usersRepository.findOne({
      where: { id: payload.sub },
      relations: ['roles'],
    });

    if (!user) {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
    }

    // 마지막 사용 시간 업데이트 후 기존 토큰 무효화
    await this.refreshTokenRepository.update(payload.tokenId, {
      lastUsedAt: new Date(),
    });

    await this.revokeRefreshToken(payload.tokenId, payload.sub);

    await this.auditLogService.log({
      userId: user.id,
      action: AuditAction.TOKEN_REFRESH,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const isPersistent = storedToken.isPersistent;

    // 새 토큰 생성
    return this.generateTokens(user, context, isPersistent);
  }

  // ===== 로그아웃 =====
  async logout(
    userId: number,
    accessToken: string,
    refreshToken: string,
    context: LoginContext,
  ) {
    // Access Token 블랙리스트 추가
    const accessPayload = this.jwtService.decode(accessToken) as any;
    if (accessPayload && accessPayload.exp) {
      const expiresIn = accessPayload.exp - Math.floor(Date.now() / 1000);
      if (expiresIn > 0) {
        await this.redisService.addToBlacklist(accessToken, expiresIn);
      }
    }

    // Refresh Token 무효화
    if (refreshToken) {
      try {
        const refreshPayload = this.jwtService.verify(refreshToken, {
          secret: this.configService.get('JWT_REFRESH_SECRET'),
        }) as JwtPayload;

        if (refreshPayload.tokenId) {
          await this.revokeRefreshToken(refreshPayload.tokenId, userId);
        }
      } catch (error) {
        // 이미 만료된 토큰은 무시
      }
    }

    await this.auditLogService.log({
      userId,
      action: AuditAction.LOGOUT,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { message: '로그아웃 되었습니다.' };
  }

  // ===== 모든 세션 로그아웃 =====
  async logoutAllDevices(userId: number, context: LoginContext) {
    await this.revokeAllUserTokens(userId);

    await this.auditLogService.log({
      userId,
      action: AuditAction.LOGOUT,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { allDevices: true },
    });

    return { message: '모든 디바이스에서 로그아웃되었습니다.' };
  }

  // ===== 토큰 검증 =====
  async verifyAccessToken(token: string): Promise<JwtPayload> {
    // 블랙리스트 확인
    const isBlacklisted = await this.redisService.isBlacklisted(token);
    if (isBlacklisted) {
      throw new UnauthorizedException('로그아웃된 토큰입니다.');
    }

    try {
      return this.jwtService.verify(token, {
        secret: this.configService.get('JWT_SECRET'),
      });
    } catch (error) {
      throw new UnauthorizedException('유효하지 않거나 만료된 토큰입니다.');
    }
  }

  // ===== Private 헬퍼 메서드 =====
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private async revokeRefreshToken(tokenId: string, userId: number) {
    await this.refreshTokenRepository.update(tokenId, {
      isRevoked: true,
      revokedAt: new Date(),
    });

    await this.redisService.revokeRefreshToken(userId, tokenId);
  }

  private async revokeAllUserTokens(userId: number) {
    await this.refreshTokenRepository.update(
      { userId, isRevoked: false },
      { isRevoked: true, revokedAt: new Date() },
    );

    await this.redisService.revokeAllUserRefreshTokens(userId);
  }

  // ===== 활성 세션 조회 =====
  async getActiveSessions(userId: number) {
    return this.refreshTokenRepository.find({
      where: { userId, isRevoked: false },
      select: ['id', 'userAgent', 'ipAddress', 'createdAt', 'lastUsedAt'],
      order: { createdAt: 'DESC' },
    });
  }

  // ===== 특정 세션 무효화 =====
  async revokeSession(userId: number, tokenId: string, context: LoginContext) {
    const token = await this.refreshTokenRepository.findOne({
      where: { id: tokenId, userId },
    });

    if (!token) {
      throw new BadRequestException('세션을 찾을 수 없습니다.');
    }

    await this.revokeRefreshToken(tokenId, userId);

    await this.auditLogService.log({
      userId,
      action: AuditAction.LOGOUT,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { revokedTokenId: tokenId },
    });

    return { message: '세션이 무효화되었습니다.' };
  }

  // ===== 인증 메일 재발송 =====
  async resendVerificationEmail(email: string, ipAddress: string) {
    // Rate Limiting: 1분에 3회 제한
    const canAttempt = await this.redisService.checkRateLimit(
      `resend-verify:${ipAddress}`,
      3,
      60,
    );

    if (!canAttempt) {
      throw new HttpException(
        '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.usersRepository.findOne({
      where: { email },
    });

    if (!user) {
      // 보안상 사용자 존재 여부를 노출하지 않음
      return { message: '해당 이메일로 인증 메일이 발송되었습니다.' };
    }

    if (user.isEmailVerified) {
      throw new BadRequestException('이미 인증된 이메일입니다.');
    }

    // 쿨다운 확인 (이전 발송 후 3분 이내면 차단)
    const remainingCooldown = await this.redisService.getEmailVerificationCooldown(user.id);
    if (remainingCooldown > 0) {
      throw new BadRequestException(
        `인증 메일이 이미 발송되었습니다. ${Math.ceil(remainingCooldown / 60)}분 후 재발송할 수 있습니다.`,
      );
    }

    const verificationToken = this.generateSecureToken();
    await this.redisService.storeEmailVerificationToken(
      user.id,
      verificationToken,
      3600, // 1시간
    );

    await this.emailService.sendVerificationEmail(
      user.email,
      verificationToken,
    );

    // 재발송 쿨다운 설정 (3분)
    await this.redisService.setEmailVerificationCooldown(user.id);

    return { message: '해당 이메일로 인증 메일이 발송되었습니다.' };
  }

  // ===== 이메일 중복 검증 =====
  async checkEmailDuplicate(email: string, ipAddress: string) {
    // Rate Limiting: 1분에 20회 제한
    const canAttempt = await this.redisService.checkRateLimit(
      `check-email:${ipAddress}`,
      20, // IP당 20회
      60, // 1분
    );

    if (!canAttempt) {
      throw new HttpException(
        '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const exists = await this.usersRepository.exists({
      where: { email },
    });

    return {
      available: !exists,
      message: exists ? '이미 사용 중인 이메일입니다.' : '사용 가능한 이메일입니다.',
    };
  }

  // ===== 닉네임 중복 검증 =====
  async checkNicknameDuplicate(nickName: string, ipAddress: string) {
    // Rate Limiting: 1분에 20회 제한
    const canAttempt = await this.redisService.checkRateLimit(
      `check-nickname:${ipAddress}`,
      20, // IP당 20회
      60, // 1분
    );

    if (!canAttempt) {
      throw new HttpException(
        '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const exists = await this.usersRepository.exists({
      where: { nickName },
    });

    return {
      available: !exists,
      message: exists ? '이미 사용 중인 닉네임입니다.' : '사용 가능한 닉네임입니다.',
    };
  }
}
