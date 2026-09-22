import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DemoAccountGuard } from '../auth/guards/demo-account.guard';
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
 * 관리자만: JwtAuthGuard(토큰) + RolesGuard(Role.ADMIN).
 *
 * 데모 계정(포트폴리오 방문자, 토큰 payload `isDemo`) 규칙 — 2026-09-23 외부 배포(설계 §9 "외부 배포"):
 *  · 조회(incidents·release-health·pending·stats)     그대로. 목록 기간만 24h → 14d(조용한 날 빈 화면 방지)
 *  · AI 분석                                          저장된 분석은 그대로, 새 분석은 시간당 상한, force·simulate 는 403 (OpsAnalysisService)
 *  · 평가 저장                                        저장은 되지만 집계·few-shot 에서 제외(OpsReviewService.HUMAN_REVIEWER), 대기 목록은 항상 전체
 *  · 사실 메모 PUT                                    DemoAccountGuard — 모두가 보는 "정답"이고 앱에 편집 화면도 없다
 *  · 기기 등록                                        저장하지 않고 `{registered:false, reason:'demo'}` — 외부 폰에 운영 장애 푸시 금지
 * 로컬 개발의 관리자가 데모 계정이면 메모 PUT 만 막힌다 — 메모는 스크립트(`ops-review-set.ts notes seed`)가 DB 로 직접 넣으므로 영향 없다.
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
   * GET /v1/ops/incidents — 최근 24h 인시던트 목록(축약형). 데모 계정은 최근 14d(X-Period 헤더로 알린다).
   * X-Cache: HIT|MISS 헤더로 Redis 캐시 적중 여부를 알린다(디버깅/e2e 검증용, body 는 설계 그대로 배열).
   */
  @Get('incidents')
  async getIncidents(
    @User('isDemo') isDemo: boolean | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IncidentSummary[]> {
    const { items, cached, period } = await this.opsService.getIncidents({ isDemo: isDemo === true });
    res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
    res.setHeader('X-Period', period);
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
   * DemoAccountGuard 를 걸지 않는다: 이 앱의 핵심 장면이라 데모 계정도 저장된 분석을 보고 처음 열린 인시던트는 분석할 수 있어야 한다.
   * 대신 데모 계정은 서비스 안에서 force·simulate 403 + 시간당 새 분석 상한(OPS_ANALYSIS_DEMO_MAX_PER_HOUR) 이 걸린다.
   * 서버 전체로는 분당 LLM 호출 상한(OPS_ANALYSIS_MAX_LLM_PER_MIN)이 쿼터를 지킨다.
   */
  @Post('incidents/:id/analysis')
  async analyzeIncident(
    @User('sub') reviewerId: number,
    @User('isDemo') isDemo: boolean | undefined,
    @Param('id') id: string,
    @Body() dto: CreateAnalysisDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AnalysisResponse> {
    const { item, cached } = await this.analysisService.analyze(id, dto, { isDemo: isDemo === true });
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
   * DemoAccountGuard(2026-09-23 외부 배포): 메모는 모든 채점 카드와 S4 에 "정답"으로 붙는 공용 데이터라 외부 방문자가 덮어쓰면 안 된다.
   * 앱에는 메모 편집 화면이 없어 데모 체험에 잃는 것이 없고, 로컬 seed 는 스크립트가 DB 로 직접 넣는다.
   */
  @Put('incidents/:id/note')
  @UseGuards(DemoAccountGuard)
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
  async listPendingReviews(
    @User('sub') reviewerId: number,
    @User('isDemo') isDemo: boolean | undefined,
  ): Promise<PendingReviewItem[]> {
    // 데모 계정은 방문자 모두가 한 계정이라 "내가 채점한 카드"를 빼면 뒤 방문자가 빈 화면을 본다 → 항상 전체
    return this.reviewService.listPending(reviewerId, { showAll: isDemo === true });
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
   * DemoAccountGuard 를 걸지 않는다: 저장되는 것은 본인의 판정 한 줄이라 남의 데이터가 바뀌지 않고, 스와이프가 이 앱의 핵심 장면이다.
   * 데모 계정의 판정은 저장은 되지만 집계(stats)·few-shot 풀·S4 요약에서 빠진다(OpsReviewService.HUMAN_REVIEWER).
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
   * DemoAccountGuard 를 걸지 않는다: 앱이 켤 때마다 부르는 호출이라 403 은 에러 화면이 된다. 대신 데모 계정은
   * 저장하지 않고 `{registered:false, reason:'demo'}` 를 돌려주며 프로필의 "푸시 알림" 칸이 그 이유를 보여준다
   * (외부 방문자의 폰에 운영 장애 푸시가 가면 안 된다 — 폴러도 is_demo 사용자를 발송에서 뺀다).
   */
  @Post('devices')
  async registerDevice(
    // 토큰 payload 의 사용자 id 는 `sub` 다(JwtAuthGuard 가 payload 를 그대로 req.user 에 넣는다).
    // `id` 로 읽으면 undefined 가 들어가 user_id NOT NULL 위반으로 500 이 된다.
    @User('sub') userId: number,
    @User('isDemo') isDemo: boolean | undefined,
    @Body() dto: RegisterDeviceDto,
  ): Promise<{ registered: boolean; reason?: 'demo' }> {
    return this.opsService.registerDevice(userId, dto, { isDemo: isDemo === true });
  }
}
