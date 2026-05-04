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

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@User('sub') userId: number) {
    return this.authService.getMe(userId);
  }

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

  @Post('demo-login')
  @HttpCode(200)
  async demoLogin(
    @Res({ passthrough: true }) res: Response,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-device-id') deviceId?: string,
  ) {
    const result = await this.authService.demoLogin({ ipAddress, userAgent, deviceId });
    this.setRefreshCookie(res, result.refreshToken, false);
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      tokenType: result.tokenType,
      user: result.user,
    };
  }

  @Post('login')
  async login(
    @Res({ passthrough: true }) res: Response,
    @Body() body: LoginDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-device-id') deviceId?: string,
  ) {
    const result = await this.authService.login(body, {
      ipAddress,
      userAgent,
      deviceId,
    });

    // refreshToken은 httpOnly 쿠키로 설정
    this.setRefreshCookie(res, result.refreshToken, result.isPersistent);

    // accessToken만 응답으로 반환 (refreshToken 제외)
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      tokenType: result.tokenType,
      user: result.user,
    };
  }

  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-device-id') deviceId?: string,
  ) {
    // 쿠키에서 refreshToken 읽기
    const refreshToken = req.cookies?.refreshToken;

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

    // accessToken만 응답으로 반환
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      tokenType: result.tokenType,
      user: result.user,
    };
  }


  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @User('sub') userId: number,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-device-id') deviceId?: string,
  ) {
    // Authorization 헤더에서 accessToken 추출 (JwtAuthGuard가 이미 검증 완료)
    const accessToken = req.headers.authorization?.split(' ')[1] || '';

    // 쿠키에서 refreshToken 읽기
    const refreshToken = req.cookies?.refreshToken || '';

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