import { z } from 'zod';

/**
 * 문의 작성 폼 검증 — 경계값은 백엔드 DTO 와 같게 둔다(어긋나면 "프론트는 통과, 서버는 400").
 * 출처: backend/src/inquiry/dto/create-inquiry.dto.ts
 *   title   @Length(2, 200)
 *   content @IsString()  — 서버는 빈 문자열도 받지만, 내용 없는 문의는 화면에서 막는다
 */
export const INQUIRY_TITLE_MIN = 2;
export const INQUIRY_TITLE_MAX = 200;

export const inquirySchema = z.object({
  title: z
    .string()
    .trim()
    .min(INQUIRY_TITLE_MIN, `제목은 ${INQUIRY_TITLE_MIN}자 이상 입력해주세요.`)
    .max(INQUIRY_TITLE_MAX, `제목은 ${INQUIRY_TITLE_MAX}자 이하로 입력해주세요.`),
  content: z.string().trim().min(1, '문의 내용을 입력해주세요.'),
  isSecret: z.boolean(),
});

export type InquiryFormValues = z.infer<typeof inquirySchema>;
