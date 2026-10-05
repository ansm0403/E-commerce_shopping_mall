import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UserModel } from './entity/user.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserModel)
    private readonly userRepository: Repository<UserModel>,
    private readonly authService: AuthService,
  ) {}

  async getProfile(userId: number) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['roles'],
    });

    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    return user;
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    if (dto.nickName !== undefined) user.nickName = dto.nickName;
    if (dto.phoneNumber !== undefined) user.phoneNumber = dto.phoneNumber;
    if (dto.address !== undefined) user.address = dto.address;

    await this.userRepository.save(user);

    return this.getProfile(userId);
  }

  /**
   * 비밀번호 변경. 성공하면 **모든 세션을 끊는다**(이 요청의 access 토큰 포함) — 비밀번호가 새서 바꾸는 경우
   * 이미 로그인해 있는 쪽이 그대로 남으면 안 된다. 클라이언트는 응답을 받고 다시 로그인한다.
   */
  async changePassword(userId: number, dto: ChangePasswordDto, currentAccessToken?: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    const isMatch = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isMatch) {
      throw new BadRequestException('현재 비밀번호가 일치하지 않습니다.');
    }

    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('새 비밀번호는 현재 비밀번호와 달라야 합니다.');
    }

    // 해시 강도는 가입(auth.service register)과 같게
    user.password = await bcrypt.hash(dto.newPassword, 12);
    await this.userRepository.save(user);

    await this.authService.revokeAllSessions(userId, currentAccessToken);

    return { message: '비밀번호가 변경되었습니다. 다시 로그인해주세요.' };
  }
}
