import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: '현재 비밀번호를 입력해주세요' })
  currentPassword: string;

  // 규칙은 가입(auth/dto/register.dto.ts)과 같아야 한다 — 변경 쪽이 약하면 가입 때 못 쓰는 비밀번호로 바꿀 수 있다.
  @IsString({ message: '비밀번호는 문자열이어야 합니다' })
  @MinLength(8, { message: '비밀번호는 최소 8자 이상이어야 합니다' })
  @MaxLength(100, { message: '비밀번호는 최대 100자까지 입력 가능합니다' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message: '비밀번호는 대문자, 소문자, 숫자, 특수문자를 포함해야 합니다',
  })
  newPassword: string;
}
