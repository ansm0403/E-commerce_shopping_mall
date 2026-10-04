import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DemoAccountGuard } from '../auth/guards/demo-account.guard';
import { User } from '../auth/decorators/user.decorator';
import { Serialize } from '../common/interceptors/serialize.interceptor';
import { UserProfileResponseDto } from './dto/user-profile-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditAction } from '../audit/entity/audit-log.entity';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  @Serialize(UserProfileResponseDto)
  getProfile(@User('sub') userId: number) {
    return this.userService.getProfile(userId);
  }

  // DemoAccountGuard: 데모 로그인은 환경변수의 비밀번호로 일반 로그인을 대신 해 주는 방식이라(auth.service demoLogin),
  // 방문자가 데모 계정의 비밀번호·프로필을 바꾸면 "체험하기" 가 모든 방문자에게 실패한다.
  @Patch('me')
  @UseGuards(DemoAccountGuard)
  @Serialize(UserProfileResponseDto)
  @Auditable(AuditAction.PROFILE_UPDATED)
  updateProfile(
    @User('sub') userId: number,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.userService.updateProfile(userId, dto);
  }

  @Patch('me/password')
  @UseGuards(DemoAccountGuard)
  @Auditable(AuditAction.PASSWORD_CHANGE)
  changePassword(
    @User('sub') userId: number,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.userService.changePassword(userId, dto);
  }
}
