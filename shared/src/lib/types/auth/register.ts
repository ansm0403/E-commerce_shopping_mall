/**
 * 회원가입 요청 타입
 * Next.js 클라이언트와 Nest.js 서버 간 데이터 형식 정의
 */
export interface RegisterRequest {
  email: string;
  password: string;
  nickName: string;
  phoneNumber: string;
  address: string;
}

/**
 * 회원가입 응답 타입
 */
export interface RegisterResponse {
  message: string;
  /** 인증 메일 발송 성공 여부. false 면 가입은 됐지만 메일이 안 간 것 — 재발송 유도 */
  emailSent: boolean;
}
