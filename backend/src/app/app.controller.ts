import { Controller, Get } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getData() {
    console.log("나야");
    return this.appService.getData();
  }

  @Get('health')
  getHealth() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  // [임시] Sentry 알림(새 이슈 생성) 테스트용 — 호출할 때마다 유니크 fingerprint로
  // 매번 "새 이슈"를 강제 생성한다. 그래야 'A new issue is created' 룰이 발동한다.
  // 테스트 후 제거할 것.
  @Get('debug-sentry')
  debugSentry() {
    const id = `be-${Date.now()}`;
    Sentry.captureException(new Error(`Sentry 백엔드 테스트 — ${id}`), {
      fingerprint: [id],
    });
    return { sent: id };
  }
}
