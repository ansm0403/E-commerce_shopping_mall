import { z } from 'zod';

/**
 * 비밀번호 변경 폼 검증 — 새 비밀번호 규칙은 백엔드 DTO 와 같게 둔다(가입 규칙과도 같다).
 * 출처: backend/src/user/dto/change-password.dto.ts (= backend/src/auth/dto/register.dto.ts 의 password)
 *   @MinLength(8) @MaxLength(100)
 *   @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
 * "현재와 달라야 한다"도 서버가 400 으로 막는다 — 화면에서 먼저 알려 준다.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 100;
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, '현재 비밀번호를 입력해주세요.'),
    newPassword: z
      .string()
      .min(PASSWORD_MIN, `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`)
      .max(PASSWORD_MAX, `비밀번호는 ${PASSWORD_MAX}자 이하여야 합니다.`)
      .regex(PASSWORD_PATTERN, '비밀번호는 대문자, 소문자, 숫자, 특수문자(@$!%*?&)를 포함해야 합니다.'),
    newPasswordConfirm: z.string().min(1, '새 비밀번호를 한 번 더 입력해주세요.'),
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: '새 비밀번호는 현재 비밀번호와 달라야 합니다.',
    path: ['newPassword'],
  })
  .refine((v) => v.newPassword === v.newPasswordConfirm, {
    message: '새 비밀번호가 일치하지 않습니다.',
    path: ['newPasswordConfirm'],
  });

export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;
