import { inquirySchema, INQUIRY_TITLE_MAX, INQUIRY_TITLE_MIN } from './inquiry-schema';
import { profileSchema, PROFILE_LIMITS } from './profile-schema';
import { changePasswordSchema, PASSWORD_MAX, PASSWORD_MIN } from './password-schema';

/**
 * 폼 검증 스키마의 경계값 — 백엔드 DTO 와 같은 값이어야 한다(05-buyer-flow-complete §2 D7).
 * 어긋나면 "화면은 통과, 서버는 400"(또는 그 반대)이 생긴다. 숫자를 바꾸려면 DTO 와 함께 바꾼다.
 *   inquiry  ← backend/src/inquiry/dto/create-inquiry.dto.ts   title @Length(2, 200)
 *   profile  ← backend/src/user/dto/update-profile.dto.ts      nickName 2~20 · phoneNumber 10~15 · address 5~200
 *   password ← backend/src/user/dto/change-password.dto.ts     8~100 + 대·소문자·숫자·특수문자
 */
const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;
const firstMessage = (schema: { safeParse: (v: unknown) => any }, value: unknown): string | undefined =>
  schema.safeParse(value).error?.issues[0]?.message;

describe('inquirySchema — 제목 2~200자, 내용 필수', () => {
  const base = { title: '배송 문의', content: '언제 오나요?', isSecret: false };

  it('DTO 와 같은 경계값을 쓴다', () => {
    expect([INQUIRY_TITLE_MIN, INQUIRY_TITLE_MAX]).toEqual([2, 200]);
  });

  it.each([
    ['1자', 'a', false],
    ['2자(최소)', 'ab', true],
    ['200자(최대)', 'a'.repeat(200), true],
    ['201자', 'a'.repeat(201), false],
  ])('제목 %s', (_label, title, expected) => {
    expect(ok(inquirySchema, { ...base, title })).toBe(expected);
  });

  it('공백만 있는 제목·내용은 통과하지 못한다(앞뒤 공백을 걷어 내고 센다)', () => {
    expect(ok(inquirySchema, { ...base, title: '   ' })).toBe(false);
    expect(ok(inquirySchema, { ...base, content: '   ' })).toBe(false);
    expect(firstMessage(inquirySchema, { ...base, content: '' })).toBe('문의 내용을 입력해주세요.');
  });
});

describe('profileSchema — 닉네임 2~20 · 연락처 10~15 · 주소 5~200', () => {
  const base = { nickName: '홍길동', phoneNumber: '01012345678', address: '서울시 강남구' };

  it('DTO 와 같은 경계값을 쓴다', () => {
    expect(PROFILE_LIMITS).toEqual({
      nickName: { min: 2, max: 20 },
      phoneNumber: { min: 10, max: 15 },
      address: { min: 5, max: 200 },
    });
  });

  it.each([
    ['nickName', 'a', false],
    ['nickName', 'ab', true],
    ['nickName', 'a'.repeat(20), true],
    ['nickName', 'a'.repeat(21), false],
    ['phoneNumber', '1'.repeat(9), false],
    ['phoneNumber', '1'.repeat(10), true],
    ['phoneNumber', '1'.repeat(15), true],
    ['phoneNumber', '1'.repeat(16), false],
    ['address', 'a'.repeat(4), false],
    ['address', 'a'.repeat(5), true],
    ['address', 'a'.repeat(200), true],
    ['address', 'a'.repeat(201), false],
  ])('%s = %p → %p', (field, value, expected) => {
    expect(ok(profileSchema, { ...base, [field]: value })).toBe(expected);
  });
});

describe('changePasswordSchema — 가입과 같은 규칙 + 확인 일치 + 현재와 다름', () => {
  const CURRENT = 'Current-pass-1!';
  const form = (newPassword: string, confirm = newPassword, currentPassword = CURRENT) => ({
    currentPassword,
    newPassword,
    newPasswordConfirm: confirm,
  });

  it('DTO 와 같은 길이 경계를 쓴다', () => {
    expect([PASSWORD_MIN, PASSWORD_MAX]).toEqual([8, 100]);
  });

  it.each([
    ['규칙을 다 채움', 'Abcd123!', true],
    ['7자', 'Abc123!', false],
    ['대문자 없음', 'abcd123!', false],
    ['소문자 없음', 'ABCD123!', false],
    ['숫자 없음', 'Abcdefg!', false],
    ['특수문자 없음', 'Abcd1234', false],
    ['100자(최대)', `Aa1!${'a'.repeat(96)}`, true],
    ['101자', `Aa1!${'a'.repeat(97)}`, false],
  ])('새 비밀번호: %s', (_label, password, expected) => {
    expect(ok(changePasswordSchema, form(password))).toBe(expected);
  });

  it('확인이 다르면 확인 칸에 문구', () => {
    const result = changePasswordSchema.safeParse(form('Abcd123!', 'Abcd123?'));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ['newPasswordConfirm'],
      message: '새 비밀번호가 일치하지 않습니다.',
    });
  });

  it('현재 비밀번호와 같으면 통과하지 못한다(서버도 400)', () => {
    const result = changePasswordSchema.safeParse(form(CURRENT));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ['newPassword'],
      message: '새 비밀번호는 현재 비밀번호와 달라야 합니다.',
    });
  });

  it('현재 비밀번호는 비어 있으면 안 된다', () => {
    expect(ok(changePasswordSchema, form('Abcd123!', 'Abcd123!', ''))).toBe(false);
  });
});
