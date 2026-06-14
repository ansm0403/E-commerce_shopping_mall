import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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

  @Patch('me')
  @Serialize(UserProfileResponseDto)
  @Auditable(AuditAction.PROFILE_UPDATED)
  updateProfile(
    @User('sub') userId: number,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.userService.updateProfile(userId, dto);
  }

  @Patch('me/password')
  @Auditable(AuditAction.PASSWORD_CHANGE)
  changePassword(
    @User('sub') userId: number,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.userService.changePassword(userId, dto);
  }
}
