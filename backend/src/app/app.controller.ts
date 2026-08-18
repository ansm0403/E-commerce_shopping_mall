import { Controller, Get } from '@nestjs/common';
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
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      // 배포 진단용: Dockerfile 이 --build-arg GIT_SHA 로 주입(APP_VERSION).
      // "8/11의 무의미한 pull" 같은 사고를 curl 한 번으로 판별하기 위함
      // (docs/roadmap/ex-db-migration.md §4-2②). 로컬/미주입 시 'dev'.
      version: process.env.APP_VERSION || 'dev',
    };
  }
}
