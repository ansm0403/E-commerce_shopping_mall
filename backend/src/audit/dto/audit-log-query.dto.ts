import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsBoolean, Max, Min } from 'class-validator';
import { AuditAction } from '../entity/audit-log.entity';

export class AuditLogQueryDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  // 상한 100: 프론트는 50 고정. admin 전용이지만 URL 조작으로 거대 take 시 무거운 쿼리 방지.
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  take?: number = 50;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  userId?: number;

  @IsOptional()
  @IsString()
  action?: AuditAction;

  // ⚠ 전역 ValidationPipe 의 enableImplicitConversion 이 @Transform 보다 먼저 돌며
  // 'false'(string) → true(boolean) 로 coerce 해버린다(Boolean('false')===true).
  // 그래서 coerce 된 `value` 가 아니라 원본 소스 `obj[key]`(raw 쿼리스트링)를 읽어 변환한다.
  @IsOptional()
  @Transform(({ obj, key }) => {
    const raw = obj[key];
    if (raw === 'true' || raw === true) return true;
    if (raw === 'false' || raw === false) return false;
    return undefined; // 미지정/알 수 없는 값 → 필터 미적용
  })
  @IsBoolean()
  success?: boolean;

  // ⚠ @IsString 이면 'foo' 같은 값이 통과해 new Date('foo')=Invalid Date → pg 500.
  // @IsDateString 으로 ISO 8601('YYYY-MM-DD' 포함)만 허용 → 잘못된 값은 400.
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;
}
