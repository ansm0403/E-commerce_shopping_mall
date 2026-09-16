import { IsOptional, IsString } from 'class-validator';

/**
 * 토큰 갱신 요청 body.
 *
 * 웹은 refreshToken 을 httpOnly 쿠키로만 보내므로 body 가 비어 있다(→ 이 DTO 는 빈 객체).
 * 모바일 앱(RN Ops Companion)은 쿠키를 구워줄 중간 서버(BFF)가 없어 body 로 보낸다.
 * 컨트롤러는 `쿠키 ?? body` 순서로 읽으므로, 쿠키가 있는 웹 요청의 동작은 바뀌지 않는다.
 * (docs/roadmap/ops-companion-design.md §5.6)
 */
export class RefreshDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
