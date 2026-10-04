import { z } from 'zod';

/**
 * 프로필 수정 폼 검증 — 경계값은 백엔드 DTO 와 같게 둔다.
 * 출처: backend/src/user/dto/update-profile.dto.ts
 *   nickName    @Length(2, 20)
 *   phoneNumber @Length(10, 15)
 *   address     @Length(5, 200)
 */
export const PROFILE_LIMITS = {
  nickName: { min: 2, max: 20 },
  phoneNumber: { min: 10, max: 15 },
  address: { min: 5, max: 200 },
} as const;

const between = (label: string, { min, max }: { min: number; max: number }) =>
  z
    .string()
    .trim()
    .min(min, `${label} ${min}자 이상 입력해주세요.`)
    .max(max, `${label} ${max}자 이하로 입력해주세요.`);

export const profileSchema = z.object({
  nickName: between('닉네임은', PROFILE_LIMITS.nickName),
  phoneNumber: between('연락처는', PROFILE_LIMITS.phoneNumber),
  address: between('주소는', PROFILE_LIMITS.address),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;
