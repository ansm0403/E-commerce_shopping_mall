import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { User } from '../auth/decorators/user.decorator';
import { Role } from '../user/entity/role.entity';
import { OpsService } from './ops.service';
import { OpsAnalysisService } from './ops-analysis.service';
import { OpsReviewService } from './ops-review.service';
import { OpsNoteService } from './ops-note.service';
import { IncidentSummary } from './dto/incident-summary.dto';
import { AnalysisResponse, CreateAnalysisDto } from './dto/analysis.dto';
import { CreateReviewDto, PendingReviewItem, ReviewResponse, ReviewStats } from './dto/review.dto';
import { IncidentNoteView, UpsertNoteDto } from './dto/note.dto';
import { IncidentDetail } from './dto/incident-detail.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { ReleaseHealth } from './dto/release-health.dto';

/**
 * /v1/ops — RN Ops Companion 전용 엔드포인트 (설계 §5.1).
 * 전역 prefix 가 v1 이므로 여기엔 붙이지 않는다(과거 이중 prefix 버그).
 * 관리자만: JwtAuthGuard(토큰) + RolesGuard(Role.ADMIN). 조회 전용이라 DemoAccountGuard 는 걸지 않는다.
 */
@Controller('ops')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class OpsController {
  constructor(
    private readonly opsService: OpsService,
    private readonly analysisService: OpsAnalysisService,
    private readonly reviewService: OpsReviewService,
    private readonly noteService: OpsNoteService,
  ) {}

  /**
   * GET /v1/ops/incidents — 최근 24h 인시던트 목록(축약형).
   * X-Cache: HIT|MISS 헤더로 Redis 캐시 적중 여부를 알린다(디버깅/e2e 검증용, body 는 설계 그대로 배열).
   */
  @Get('incidents')
  async getIncidents(@Res({ passthrough: true }) res: Response): Promise<IncidentSummary[]> {
    const { items, cached } = await this.opsService.getIncidents();
    res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
    return items;
  }

  /**
   * GET /v1/ops/incidents/:id — 인시던트 상세(스택트레이스·breadcrumbs 축약형). 푸시 딥링크의 도착지.
   * 없는 id 는 404 — 앱은 "지워졌거나 접근할 수 없는 인시던트" 화면을 그린다.
   */
  @Get('incidents/:id')
  async getIncident(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IncidentDetail> {
    const { item, cached } = await this.opsService.getIncident(id);
    res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
    return item;
  }

  /**
   * POST /v1/ops/incidents/:id/analysis — AI 분석 생성 또는 최근 결과 반환(설계 §3.4 · §5.1).
   *
   * POST 인 이유: 첫 호출이 LLM 을 부르고 행을 만든다(부수효과). 두 번째부터는 최근 행을 돌려주며
   * X-Cache: HIT 다. body `{ force: true }` 면 새로 분석한다(앱의 "다시 분석").
   * LLM 키 없음 503 · 없는 이슈 404 · 분당 상한 429 · 같은 이슈 동시 요청 409.
   *
   * DemoAccountGuard 를 걸지 않는다: 로컬 DB 의 관리자가 데모 계정이라 걸면 앱 개발이 막힌다.
   * 대신 분당 상한이 쿼터를 지킨다(호출당 최대 LLM 2왕복 × 분당 5건 = 10 RPM < 무료티어 15).
   */
  @Post('incidents/:id/analysis')
  async analyzeIncident(
    @User('sub') reviewerId: number,
    @Param('id') id: string,
    @Body() dto: CreateAnalysisDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AnalysisResponse> {
    const { item, cached } = await this.analysisService.analyze(id, dto);
    res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
    return this.enrichAnalysis(item, reviewerId ?? null);
  }

  /**
   * 분석 응답 보강(Phase 8 후속) — 사실 메모(운영 메모) · 조치 코드 이름 대조 · 사람 채점 요약.
   * 왜 컨트롤러에서 하나: OpsAnalysisService 는 OpsNoteService 를 주입받으면 안 된다(메모 = LLM 입력 금지, 단위 테스트가 고정).
   * 채점 카드(S5)에 있던 근거가 "고치는 사람"의 화면(S4)에는 없었다 — 조치를 붙여 넣기 전에 봐야 하는 정보다.
   * 셋 다 부가물이라 어느 하나가 실패해도 분석은 그대로 나간다(null).
   */
  private async enrichAnalysis(item: AnalysisResponse, reviewerId: number | null): Promise<AnalysisResponse> {
    const [note, reviewSummary] = await Promise.all([
      this.noteService.findByIncident(item.incidentId).catch(() => null),
      this.reviewService.summarizeReviews(item.id, reviewerId).catch(() => null),
    ]);
    const identifierCheck = await this.reviewService.identifierCheckFor(item, note).catch(() => null);
    return { ...item, note, identifierCheck, reviewSummary };
  }

  /**
   * PUT /v1/ops/incidents/:id/note — 인시던트별 사실 메모 upsert(Phase 7). 인시던트당 하나라 PUT(통째로 덮어쓰기).
   * body.code 가 있으면 서버가 그 커밋의 코드를 읽어 함께 저장한다(읽기 실패 400 — 반쯤 채운 메모를 남기지 않는다).
   * 처음이면 X-Note: CREATED, 덮어썼으면 UPDATED(평가 저장의 X-Review 와 같은 관례).
   *
   * Sentry 를 부르지 않는다 — 옛 인시던트(24h 목록 밖)에도 메모를 달 수 있어야 하고, 스크립트가 seed 할 때 토큰 없이도 돌아야 한다.
   * DemoAccountGuard 를 걸지 않는다: 분석·평가 엔드포인트와 같은 이유(로컬 관리자가 데모 계정). 메모는 LLM 입력에 들어가지 않으므로
   * 잘못 써도 오염되는 것은 채점 안내뿐이고, 다시 PUT 하면 고쳐진다.
   */
  @Put('incidents/:id/note')
  async upsertNote(
    @User('sub') authorId: number,
    @Param('id') id: string,
    @Body() dto: UpsertNoteDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IncidentNoteView> {
    const { item, created } = await this.noteService.upsert(id, dto, authorId ?? null);
    res.setHeader('X-Note', created ? 'CREATED' : 'UPDATED');
    return item;
  }

  // ── Phase 4 평가 루프(설계 §5.1 · §9 Phase 4) ───────────────────────────────
  // 정적 경로(pending·stats)를 동적 경로(:id/review)보다 먼저 둔다 — 메서드가 달라 충돌은 없지만 읽는 순서를 맞춘다.

  /**
   * GET /v1/ops/analyses/pending — 이 평가자가 아직 채점하지 않은 분석(S5 카드 스택의 재료).
   * 응답에 promptVersion 이 **없다**(블라인드 평가). 캐시하지 않는다 — 채점할 때마다 목록이 바뀌는 데이터다.
   */
  @Get('analyses/pending')
  async listPendingReviews(@User('sub') reviewerId: number): Promise<PendingReviewItem[]> {
    return this.reviewService.listPending(reviewerId);
  }

  /**
   * GET /v1/ops/analyses/stats — promptVersion 별 승인율·구조화 실패율. Phase 4 DoD 의 숫자.
   * 앱 화면은 없고(사람이 채점 중에 보면 블라인드가 깨진다) 스크립트·curl 로 본다.
   */
  @Get('analyses/stats')
  async getReviewStats(): Promise<ReviewStats> {
    return this.reviewService.getStats();
  }

  /**
   * POST /v1/ops/analyses/:id/review — 판정 저장. 같은 평가자의 재평가는 덮어쓴다(upsert, 결정 ⑤).
   * 처음이면 X-Review: CREATED, 덮어썼으면 UPDATED — 상태코드는 둘 다 201 이라 헤더로만 구분한다(e2e 용).
   * 평가 대상이 아닌 행(parse_failed·simulated) 400 · 없는 분석 404.
   *
   * DemoAccountGuard 를 걸지 않는다: 분석 엔드포인트와 같은 이유(로컬 관리자가 데모 계정). 저장되는 것은
   * 본인의 판정 한 줄이라 남의 데이터가 바뀌지 않는다.
   */
  @Post('analyses/:id/review')
  async submitReview(
    @User('sub') reviewerId: number,
    @Param('id', ParseIntPipe) analysisId: number,
    @Body() dto: CreateReviewDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReviewResponse> {
    const { item, created } = await this.reviewService.submitReview(reviewerId, analysisId, dto);
    res.setHeader('X-Review', created ? 'CREATED' : 'UPDATED');
    return item;
  }

  /**
   * GET /v1/ops/release-health — 릴리즈별 crash-free 세션 비율(설계 §6).
   * S2 목록 화면 상단 요약 카드의 데이터 원천. 읽기 전용이라 캐시 헤더 관례는 incidents 와 같다.
   */
  @Get('release-health')
  async getReleaseHealth(@Res({ passthrough: true }) res: Response): Promise<ReleaseHealth> {
    const { item, cached } = await this.opsService.getReleaseHealth();
    res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
    return item;
  }

  /**
   * POST /v1/ops/devices — 이 기기로 푸시를 받겠다는 등록. 앱이 켜질 때마다 보내므로 멱등(upsert).
   *
   * DemoAccountGuard 를 걸지 않는다: 저장되는 것은 "이 사용자의 기기 주소" 뿐이라 데모 계정이
   * 호출해도 남의 데이터가 바뀌지 않고, 막으면 데모 로그인으로는 앱이 아예 동작하지 않는다.
   */
  @Post('devices')
  async registerDevice(
    // 토큰 payload 의 사용자 id 는 `sub` 다(JwtAuthGuard 가 payload 를 그대로 req.user 에 넣는다).
    // `id` 로 읽으면 undefined 가 들어가 user_id NOT NULL 위반으로 500 이 된다.
    @User('sub') userId: number,
    @Body() dto: RegisterDeviceDto,
  ): Promise<{ registered: true }> {
    return this.opsService.registerDevice(userId, dto);
  }
}
