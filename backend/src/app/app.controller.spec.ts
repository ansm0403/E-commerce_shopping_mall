import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let app: TestingModule;
  const appService = {
    getData: jest.fn(() => ({ message: 'Hello API' })),
    checkReadiness: jest.fn(),
  };

  beforeAll(async () => {
    app = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: appService }],
    }).compile();
  });

  describe('getData', () => {
    it('should return "Hello API"', () => {
      const appController = app.get<AppController>(AppController);
      expect(appController.getData()).toEqual({ message: 'Hello API' });
    });
  });

  describe('getHealth', () => {
    const makeRes = () => ({ status: jest.fn().mockReturnThis() }) as unknown as Response & { status: jest.Mock };

    it('준비됐으면 상태 코드를 건드리지 않는다(기본 200)', async () => {
      appService.checkReadiness.mockResolvedValue({ ready: true, checks: { database: 'ok', redis: 'ok' } });
      const res = makeRes();

      const body = await app.get(AppController).getHealth(res);

      expect(res.status).not.toHaveBeenCalled();
      expect(body).toMatchObject({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
      expect(body.version).toBeDefined();
    });

    it('의존성 하나라도 down 이면 503 + status=error', async () => {
      appService.checkReadiness.mockResolvedValue({ ready: false, checks: { database: 'down', redis: 'ok' } });
      const res = makeRes();

      const body = await app.get(AppController).getHealth(res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(body).toMatchObject({ status: 'error', checks: { database: 'down', redis: 'ok' } });
    });
  });
});
