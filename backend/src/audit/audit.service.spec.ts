import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditService } from './audit.service';
import { AuditLogEntity } from './entity/audit-log.entity';
import { UserModel } from '../user/entity/user.entity';
import { CommonService } from '../common/common.service';

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: getRepositoryToken(AuditLogEntity),
          useValue: { save: jest.fn(), find: jest.fn(), create: jest.fn() },
        },
        {
          provide: getRepositoryToken(UserModel),
          useValue: { find: jest.fn(), findOne: jest.fn() },
        },
        { provide: CommonService, useValue: { paginate: jest.fn() } },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
