import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class DemoAccountGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (req.user?.isDemo) {
      throw new ForbiddenException('데모 계정에서는 사용할 수 없는 기능입니다.');
    }
    return true;
  }
}
