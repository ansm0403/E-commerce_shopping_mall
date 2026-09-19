import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getData() {
    console.log("나야");
    return this.appService.getData();
  }

  /**
   * 외부 감시(UptimeRobot)와 compose healthcheck 가 같이 보는 URL.
   * DB·Redis 중 하나라도 응답이 없으면 **503** — 감시자가 "살아 있지만 일을 못 하는" 상태를 장애로 잡게 한다.
   * compose healthcheck 도 이 URL 이라 DB 가 죽으면 backend 도 unhealthy 로 표시되는데, 그게 맞는 표시다
   * (docs/roadmap/ex-observability-map.md §7 ⑤).
   *
   * 예외를 던지지 않고 상태 코드만 바꾼다 — 503 을 HttpException 으로 던지면 전역 Sentry 필터 경로를 타고,
   * 30초마다 도는 healthcheck 가 장애 동안 이벤트를 쏟아낼 수 있다. 원인 추적은 개별 API 의 5xx 가 맡는다.
   * 전역 레이트리밋에서도 뺀다 — 감시 요청이 429 를 받으면 장애로 오인된다.
   */
  @SkipThrottle()
  @Get('health')
  async getHealth(@Res({ passthrough: true }) res: Response) {
    const { ready, checks } = await this.appService.checkReadiness();
    if (!ready) res.status(HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: ready ? 'ok' : 'error',
      checks,
      timestamp: new Date().toISOString(),
      // 배포 진단용: Dockerfile 이 --build-arg GIT_SHA 로 주입(APP_VERSION).
      // "8/11의 무의미한 pull" 같은 사고를 curl 한 번으로 판별하기 위함
      // (docs/roadmap/ex-db-migration.md §4-2②). 로컬/미주입 시 'dev'.
      version: process.env.APP_VERSION || 'dev',
    };
  }
}
