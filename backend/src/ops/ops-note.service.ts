import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { scrubText } from '../common/utils/scrub-text';
import { OpsIncidentNoteEntity } from './entity/ops-incident-note.entity';
import { SourceReaderService } from './source-reader.service';
import { IncidentNoteView, UpsertNoteDto, toNoteView } from './dto/note.dto';

/**
 * 인시던트별 사실 메모(설계 §9 Phase 7) — 쓰기(upsert)와 조회.
 *
 *   관리자/스크립트  PUT /ops/incidents/:id/note  → upsert       : 메모 4필드 + (선택) 원인 코드 범위 → 코드는 서버가 읽어 저장
 *   평가 대기 목록   OpsReviewService.listPending → SQL LEFT JOIN : 카드에 note 로 실린다(여기 메서드를 거치지 않는다)
 *
 * 왜 코드를 서버가 읽나: 확인 항목 ②("조치 코드의 이름이 실제 코드에 있는가")의 근거가 이 코드다. 사람이 옮겨 적으면
 * 오타가 곧 오판이 된다. SourceReaderService.read 는 Phase 5 의 도구 실행부 그대로 — 허용 폴더·줄 상한·scrubText 가 같다.
 *
 * ⚠ 이 서비스는 OpsAnalysisService 가 주입받지 않는다. 메모는 LLM 입력에 들어가면 안 된다(엔티티 주석).
 */
@Injectable()
export class OpsNoteService {
  private readonly logger = new Logger(OpsNoteService.name);

  constructor(
    @InjectRepository(OpsIncidentNoteEntity)
    private readonly notes: Repository<OpsIncidentNoteEntity>,
    private readonly sourceReader: SourceReaderService,
  ) {}

  /**
   * 메모 upsert. 코드 범위가 있으면 먼저 읽고(실패 → 400, 저장 안 함), 그다음 행을 통째로 덮어쓴다.
   * `code` 를 안 보내면 code_* 는 null 로 — "이번엔 코드 없이"가 명시적 선택이다(부분 갱신 없음, PUT 의미 그대로).
   */
  async upsert(incidentId: string, dto: UpsertNoteDto, authorId: number | null): Promise<{ item: IncidentNoteView; created: boolean }> {
    const id = (incidentId ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new BadRequestException('인시던트 id 형식이 아닙니다.');

    let code: { path: string; ref: string; startLine: number; endLine: number; text: string } | null = null;
    if (dto.code) {
      if (dto.code.endLine < dto.code.startLine) throw new BadRequestException('code.endLine 은 startLine 이상이어야 합니다.');
      const read = await this.sourceReader.read({
        path: dto.code.path,
        startLine: dto.code.startLine,
        endLine: dto.code.endLine,
        ref: dto.code.ref ?? this.sourceReader.getDefaultRef(),
      });
      if (!read.ok) throw new BadRequestException(`원인 코드를 읽지 못했습니다: ${read.reason}`);
      code = { path: read.path, ref: read.ref, startLine: read.startLine, endLine: read.endLine, text: read.content };
    }

    const existing = await this.notes.findOne({ where: { incidentId: id } });
    const row = existing ?? this.notes.create({ incidentId: id });
    row.project = dto.project?.trim() || null;
    row.symptom = OpsNoteService.clean(dto.symptom);
    row.causeLocation = OpsNoteService.clean(dto.causeLocation);
    row.fixDirection = OpsNoteService.clean(dto.fixDirection);
    row.commonMistakes = dto.commonMistakes?.trim() ? OpsNoteService.clean(dto.commonMistakes) : null;
    row.codePath = code?.path ?? null;
    row.codeRef = code?.ref ?? null;
    row.codeStartLine = code?.startLine ?? null;
    row.codeEndLine = code?.endLine ?? null;
    row.codeText = code?.text ?? null;
    row.authorId = authorId;

    const saved = await this.notes.save(row);
    this.logger.log(
      `사실 메모 ${existing ? '갱신' : '저장'}: incident=${id}${code ? ` code=${code.path}:${code.startLine}-${code.endLine}@${code.ref}` : ' (코드 없음)'}`,
    );
    return { item: toNoteView(saved), created: !existing };
  }

  async findByIncident(incidentId: string): Promise<IncidentNoteView | null> {
    const row = await this.notes.findOne({ where: { incidentId } });
    return row ? toNoteView(row) : null;
  }

  /** 메모도 카드로 나가는 텍스트다 — 평가자가 관리자라도 이메일 같은 값은 실리지 않게 한 번 거른다 */
  private static clean(s: string): string {
    return (scrubText(s) ?? '').trim();
  }
}
