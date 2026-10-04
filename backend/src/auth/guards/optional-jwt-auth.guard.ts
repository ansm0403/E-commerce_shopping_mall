import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthService } from '../auth.service';

/**
 * 공개 엔드포인트용 선택적 인증 — 항상 통과시키되, 유효한 Bearer 토큰이 있으면 request.user 를 채운다.
 *
 * 토큰이 없거나 만료·무효여도 401 을 내지 않는다(비로그인과 같게 취급). 공개 목록 조회 때문에
 * 프론트의 401 → refresh 경로가 돌거나 로그아웃되면 안 되기 때문이다.
 * 로그인 사용자에게만 달라지는 표시(예: 본인 비밀 문의 해제)에만 쓴다 — 권한 판정에는 JwtAuthGuard.
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return true;
    }

    try {
      request.user = await this.authService.verifyAccessToken(authHeader.substring(7));
    } catch {
      // 만료·무효 토큰은 비로그인으로 본다
    }
    return true;
  }
}
