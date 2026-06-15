import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 관리자 어시스턴트 채팅 요청.
 * - message: 이번 턴 관리자 입력.
 * - conversationId: 멀티턴 식별자(서버 인메모리 저장). 없으면 서버가 새로 발급해 응답한다. (Phase 2)
 */
export class ChatRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;
}
