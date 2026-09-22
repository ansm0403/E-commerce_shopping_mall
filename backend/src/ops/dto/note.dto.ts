import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import type { OpsIncidentNoteEntity } from '../entity/ops-incident-note.entity';

/**
 * PUT /v1/ops/incidents/:id/note 의 body 중 "원인 위치의 코드" 부분(설계 §9 Phase 7).
 * 코드 원문은 보내지 않는다 — 서버가 SourceReaderService.read 로 그 커밋에서 읽어 저장한다(사람이 옮겨 적으면 오타가 난다).
 */
export class NoteCodeDto {
  @IsString()
  @MaxLength(300)
  path: string;

  @IsInt()
  @Min(1)
  startLine: number;

  @IsInt()
  @Min(1)
  endLine: number;

  /** 읽을 커밋 SHA(7~40자) 또는 브랜치 이름. 생략하면 리더의 기본 브랜치(main) */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._/-]{1,40}$/)
  ref?: string;
}

/** PUT /v1/ops/incidents/:id/note 의 body. 인시던트당 하나라 PUT(있으면 통째로 덮어쓴다) */
export class UpsertNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  symptom: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  causeLocation: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  fixDirection: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commonMistakes?: string;

  /** Sentry 프로젝트 slug. relatedFiles 정규화 힌트(옛 분석 행엔 project 가 없다). 생략 가능 */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  project?: string;

  /** 없으면 코드 없는 메모(code_* 전부 null). 있는데 읽기에 실패하면 400 — 반쯤 채운 메모를 저장하지 않는다 */
  @IsOptional()
  @ValidateNested()
  @Type(() => NoteCodeDto)
  code?: NoteCodeDto;
}

/** 카드가 그리는 메모. 평가 대기 응답의 `note` 이자 PUT 의 응답 */
export interface IncidentNoteView {
  incidentId: string;
  project: string | null;
  symptom: string;
  causeLocation: string;
  fixDirection: string;
  commonMistakes: string | null;
  /** 원인 위치의 실제 코드(줄 번호 포함). 없으면 null */
  code: { path: string; ref: string; startLine: number; endLine: number; text: string } | null;
  /** ISO 8601 */
  updatedAt: string;
}

export function toNoteView(row: OpsIncidentNoteEntity): IncidentNoteView {
  const hasCode =
    typeof row.codePath === 'string' && typeof row.codeText === 'string' && row.codeStartLine !== null && row.codeEndLine !== null;
  return {
    incidentId: row.incidentId,
    project: row.project ?? null,
    symptom: row.symptom,
    causeLocation: row.causeLocation,
    fixDirection: row.fixDirection,
    commonMistakes: row.commonMistakes ?? null,
    code: hasCode
      ? {
          path: row.codePath as string,
          ref: row.codeRef ?? 'main',
          startLine: row.codeStartLine as number,
          endLine: row.codeEndLine as number,
          text: row.codeText as string,
        }
      : null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt ?? ''),
  };
}
