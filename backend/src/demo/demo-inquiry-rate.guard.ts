import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { RedisService } from '../intrastructure/redis/redis.service';

/** Runs after JWT authentication; ordinary buyers keep the existing global limit. */
@Injectable()
export class DemoInquiryRateGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (!request.user?.isDemo) return true;
    const allowed = await this.redis.checkRateLimit(
      `demo-inquiry:${request.ip}`,
      5,
      60
    );
    if (!allowed)
      throw new HttpException(
        '문의는 분당 5회까지 작성할 수 있습니다. 잠시 후 다시 시도해주세요.',
        HttpStatus.TOO_MANY_REQUESTS
      );
    return true;
  }
}
