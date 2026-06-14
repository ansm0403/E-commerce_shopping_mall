import { Expose } from 'class-transformer';

export class AuditLogResponseDto {
  @Expose()
  id: number;

  @Expose()
  userId: number;

  // 행위자 보강(getAuditLogs 에서 user 일괄 조회로 채움). 없으면 null.
  @Expose()
  userNickName: string | null;

  // userId 가 null 인 행은 metadata.email fallback(FAILED_LOGIN 등), 그것도 없으면 null.
  @Expose()
  userEmail: string | null;

  @Expose()
  action: string;

  @Expose()
  ipAddress: string;

  @Expose()
  userAgent: string;

  @Expose()
  metadata: Record<string, any>;

  @Expose()
  success: boolean;

  @Expose()
  errorMessage: string;

  @Expose()
  createdAt: Date;
}
