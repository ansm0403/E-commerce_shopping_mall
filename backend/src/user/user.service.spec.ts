import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserService } from './user.service';
import { UserModel } from './entity/user.entity';
import { AuthService } from '../auth/auth.service';

describe('UserService', () => {
  let service: UserService;
  let userRepository: { findOne: jest.Mock; save: jest.Mock };
  let authService: { revokeAllSessions: jest.Mock };

  const CURRENT = 'Current-pass-1!';
  const NEXT = 'Next-pass-2!';

  beforeEach(async () => {
    userRepository = { findOne: jest.fn(), save: jest.fn() };
    authService = { revokeAllSessions: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(UserModel), useValue: userRepository },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('changePassword', () => {
    const storedUser = async () => ({ id: 1, password: await bcrypt.hash(CURRENT, 4) });

    it('성공: 새 해시를 저장하고 모든 세션을 끊는다(요청의 access 토큰 포함)', async () => {
      const user = await storedUser();
      userRepository.findOne.mockResolvedValue(user);

      const result = await service.changePassword(
        1,
        { currentPassword: CURRENT, newPassword: NEXT },
        'access-token',
      );

      const saved = userRepository.save.mock.calls[0][0];
      expect(await bcrypt.compare(NEXT, saved.password)).toBe(true);
      expect(authService.revokeAllSessions).toHaveBeenCalledWith(1, 'access-token');
      expect(result.message).toContain('다시 로그인');
    });

    it('현재 비밀번호가 틀리면 400 — 저장도, 세션 폐기도 하지 않는다', async () => {
      userRepository.findOne.mockResolvedValue(await storedUser());

      await expect(
        service.changePassword(1, { currentPassword: 'Wrong-pass-1!', newPassword: NEXT }),
      ).rejects.toThrow(BadRequestException);
      expect(userRepository.save).not.toHaveBeenCalled();
      expect(authService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('새 비밀번호가 현재와 같으면 400', async () => {
      userRepository.findOne.mockResolvedValue(await storedUser());

      await expect(
        service.changePassword(1, { currentPassword: CURRENT, newPassword: CURRENT }),
      ).rejects.toThrow('새 비밀번호는 현재 비밀번호와 달라야 합니다.');
      expect(userRepository.save).not.toHaveBeenCalled();
      expect(authService.revokeAllSessions).not.toHaveBeenCalled();
    });
  });
});
