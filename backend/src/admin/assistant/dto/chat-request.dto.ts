import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 관리자 어시스턴트 채팅 요청.
 * - message: 이번 턴 관리자 입력.
 * - conversationId: 멀티턴 식별자(서버 인메모리 저장). 없으면 서버가 새로 발급해 응답한다. (Phase 2)
 * - requestId: 이 스트림을 가리키는 클라이언트 발급 id. "중지" 때 stream/cancel 로 같은 값을 보낸다(없으면 명시적 중지 불가).
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

  @IsOptional()
  @IsString()
  @MaxLength(64)
  requestId?: string;
}

/** 진행 중인 스트림 중지 요청. */
export class CancelStreamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  requestId: string;
}
