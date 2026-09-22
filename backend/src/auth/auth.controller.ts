import {
  Body,
  Controller,
  Post,
  Get,
  Delete,
  Query,
  Param,
  Ip,
  Headers,
  HttpCode,
  UseGuards,
  Res,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { CheckEmailDto } from './dto/check-email.dto';
import { CheckNicknameDto } from './dto/check-nickname.dto';
import { RefreshDto } from './dto/refresh.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { User } from './decorators/user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setRefreshCookie(res: Response, refreshToken: string, isPersistent: boolean) {
    const base = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    }

    res.cookie('refreshToken', refreshToken, isPersistent 
      ? { ...base, maxAge: 7 * 24 * 60 * 60 * 1000 }
      : { ...base }
    );
  }

  /**
   * 토큰 응답 body 조립 — 기본은 accessToken 만(refreshToken 은 httpOnly 쿠키로만 전달).
   *
   * 예외: `X-Client: mobile` 헤더가 있으면 body 에 refreshToken 을 함께 담는다.
   * RN 앱에는 백엔드의 Set-Cookie 를 자기 도메인 쿠키로 다시 구워주는 BFF 가 없어
   * 쿠키 기반 refresh 가 불가능하기 때문(accessToken 15분 → 15분마다 로그아웃).
   * 헤더가 없으면 지금과 100% 동일 = 웹 동작 불변. 쿠키 설정도 그대로 유지한다.
   * (docs/roadmap/ops-companion-design.md §5.6 — 대안이었던 앱 전용 엔드포인트/전면 body 반환은 기각)
   */
  private buildTokenResponse(
    result: {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      tokenType: string;
      user: unknown;
    },
    client?: string,
  ) {
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      tokenType: result.tokenType,
      user: result.user,
      ...(AuthController.isMobileClient(client) ? { refreshToken: result.refreshToken } : {}),
    };
  }

  static isMobileClient(client?: string): boolean {
    return client?.trim().toLowerCase() === 'mobile';
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@User('sub') userId: number) {
    return this.authService.getMe(userId);
  }

  // register 는 토큰을 발급하지 않는다(이메일 인증 후 로그인해야 함) → X-Client 분기 대상이 아니다.
  @Post('register')
  register(
    @Body() body: RegisterDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.authService.register(body, {
      ipAddress,
      userAgent,
      deviceId,
    });
  }

  @Get('verify-email')
  async verifyEmail(
    @Res({ passthrough: true }) res: Response,
    @Query('token') token: string,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-device-id') deviceId?: string,
  ) {
    const result = await this.authService.verifyEmail(token, {
      ipAddress,
      userAgent,
      deviceId,
    });

    // refreshToken은 httpOnly 쿠키로 설정
    this.setRefreshCookie(res, result.refreshToken, false);

    // accessToken만 응답으로 반환
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      tokenType: result.tokenType,
      user: result.user,
    };
  }

  @Post('resend-verification')
  resendVerificationEmail(
    @Body('email') email: string,
    @Ip() ipAddress: string,
  ) {
    return this.authService.resendVerificationEmail(email, ipAddress);
  }

  /**
   * 데모 관리자 로그인(비밀번호 없이, DEMO_LOGIN_ENABLED 일 때만). 웹 로그인 화면의 "관리자 페이지 체험하기" 버튼과
   * RN 운영 앱의 "데모 계정으로 체험하기" 버튼이 같은 경로를 탄다 — 앱은 `X-Client: mobile` 을 붙여 login 과 똑같이
   * body 로 refreshToken 을 받는다(안 주면 15분 뒤 갱신이 실패해 로그아웃된다). 헤더가 없으면 종전과 100% 같다.
   */
  @Post('demo-login')
  @HttpCode(200)
  async demoLogin(
    @Res({ passthrough: true }) res: Response,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-device-id') deviceId?: string,
    @Headers('x-client') client?: string,
  ) {
    const result = await this.authService.demoLogin({ ipAddress, userAgent, deviceId });
    this.setRefreshCookie(res, result.refreshToken, false);
    return this.buildTokenResponse(result, client);
  }

  @Post('login')
  async login(
    @Res({ passthrough: true }) res: Response,
    @Body() body: LoginDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-device-id') deviceId?: string,
    @Headers('x-client') client?: string,
  ) {
    const result = await this.authService.login(body, {
      ipAddress,
      userAgent,
      deviceId,
    });

    // refreshToken은 httpOnly 쿠키로 설정 (모바일이어도 그대로 — 해로울 것 없고 분기를 줄인다)
    this.setRefreshCookie(res, result.refreshToken, result.isPersistent);

    // 기본: accessToken만 반환 (refreshToken 제외). X-Client: mobile 이면 refreshToken 포함.
    return this.buildTokenResponse(result, client);
  }

  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Ip() ipAddress: string,
    @Body() body?: RefreshDto,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-device-id') deviceId?: string,
    @Headers('x-client') client?: string,
  ) {
    // 쿠키 우선, 없으면 body(모바일 앱 경로). 웹은 항상 쿠키가 있으므로 body 는 읽히지 않는다.
    const refreshToken = req.cookies?.refreshToken ?? body?.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not found');
    }

    const result = await this.authService.refresh(refreshToken, {
      ipAddress,
      userAgent,
      deviceId,
    });

    // 새로운 refreshToken을 httpOnly 쿠키로 설정
    this.setRefreshCookie(res, result.refreshToken, result.isPersistent);

    // 기본: accessToken만 반환. X-Client: mobile 이면 회전된 새 refreshToken 도 body 에 포함
    // (refresh 는 1회용 회전이라 앱이 새 값을 받아 저장하지 못하면 다음 갱신이 실패한다).
    return this.buildTokenResponse(result, client);
  }


  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @User('sub') userId: number,
    @Ip() ipAddress: string,
    @Body() body?: RefreshDto,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-device-id') deviceId?: string,
  ) {
    // Authorization 헤더에서 accessToken 추출 (JwtAuthGuard가 이미 검증 완료)
    const accessToken = req.headers.authorization?.split(' ')[1] || '';

    // 쿠키 우선, 없으면 body(모바일 앱 경로) — refresh 와 같은 규칙.
    // 앱이 body 로 넘기지 않으면 서버 쪽 refreshToken 이 7일간 살아남으므로 앱은 반드시 실어 보내야 한다.
    const refreshToken = req.cookies?.refreshToken ?? body?.refreshToken ?? '';

    const result = await this.authService.logout(userId, accessToken, refreshToken, {
      ipAddress,
      userAgent,
      deviceId,
    });

    // refreshToken 쿠키 삭제
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    return result;
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  logoutAllDevices(
    @User('sub') userId: number,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.authService.logoutAllDevices(userId, {
      ipAddress,
      userAgent,
      deviceId,
    });
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  getActiveSessions(@User('sub') userId: number) {
    return this.authService.getActiveSessions(userId);
  }

  @Delete('sessions/:tokenId')
  @UseGuards(JwtAuthGuard)
  revokeSession(
    @User('sub') userId: number,
    @Param('tokenId') tokenId: string,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.authService.revokeSession(userId, tokenId, {
      ipAddress,
      userAgent,
      deviceId,
    });
  }

  @Get('check-email')
  checkEmail(
    @Query() query: CheckEmailDto,
    @Ip() ipAddress: string,
  ) {
    return this.authService.checkEmailDuplicate(query.email, ipAddress);
  }

  @Get('check-nickname')
  checkNickname(
    @Query() query: CheckNicknameDto,
    @Ip() ipAddress: string,
  ) {
    return this.authService.checkNicknameDuplicate(query.nickName, ipAddress);
  }
}