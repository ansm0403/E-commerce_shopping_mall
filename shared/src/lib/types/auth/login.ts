/**
 * 로그인 요청 타입
 * Next.js 클라이언트와 Nest.js 서버 간 데이터 형식 정의
 */
export interface LoginRequest {
  email: string;
  password: string;
  rememberMe?: boolean;
}

/**
 * 로그인 응답 타입
 * refreshToken은 httpOnly 쿠키로 전송되므로 응답 body에 포함되지 않음
 */
export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
  user: {
    id: number;
    email: string;
    nickName: string;
    roles: ('buyer' | 'seller' | 'admin')[];
    isDemo: boolean;
  };
}
