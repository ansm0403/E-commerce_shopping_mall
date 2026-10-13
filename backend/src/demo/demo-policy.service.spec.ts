import { ForbiddenException } from '@nestjs/common';
import { DemoPolicyService } from './demo-policy.service';
import { UserModel } from '../user/entity/user.entity';
import { DemoFixtureEntity } from './entity/demo-fixture.entity';
import { parseDemoRole } from '../auth/dto/demo-login';
import { SearchIndexRecorder } from '../search/search-index-recorder';
import { InquiryEntity, InquiryStatus } from '../inquiry/entity/inquiry.entity';
import type { DataSource } from 'typeorm';

describe('Role demo boundaries', () => {
  const manager = {
    query: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };
  const ds = { manager, query: jest.fn(), transaction: jest.fn() };
  let policy: DemoPolicyService;
  beforeEach(() => {
    jest.clearAllMocks();
    policy = new DemoPolicyService(ds as never);
  });
  it.each([undefined, {}])('preserves no-body admin login: %p', (body) =>
    expect(parseDemoRole(body)).toBe('admin')
  );
  it.each(['buyer', 'seller', 'admin'])(
    'accepts only known roles: %s',
    (role) => expect(parseDemoRole({ role })).toBe(role)
  );
  it.each([
    null,
    [],
    ['buyer'],
    { role: null },
    { role: ['buyer'] },
    { role: true },
    { role: 'root' },
    { role: 'buyer', email: 'other' },
  ])('rejects malformed/selected-account request: %p', (body) =>
    expect(() => parseDemoRole(body)).toThrow()
  );
  it('allows ordinary users and rejects demo account writes', async () => {
    manager.findOne
      .mockResolvedValueOnce({ isDemo: false })
      .mockResolvedValueOnce({ isDemo: true });
    await expect(policy.forbidDemo(1)).resolves.toBeUndefined();
    await expect(policy.forbidDemo(2)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });
  it('blocks financial operations on a registered synthetic order regardless of actor', async () => {
    manager.findOne.mockResolvedValue({ id: 5, orderId: 10 });
    await expect(policy.forbidFixtureOrder(10)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(manager.findOne).toHaveBeenCalledWith(DemoFixtureEntity, {
      where: { scope: 'role-demo-v1', orderId: 10 },
    });
  });
  it('rejects demo actors changing ordinary orders', async () => {
    manager.findOne.mockImplementation((entity) =>
      entity === UserModel ? { isDemo: true } : null
    );
    await expect(policy.assertOrderActor(2, 10)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(ds.query).not.toHaveBeenCalled();
  });
  it('rejects demo seller answering an ordinary buyer inquiry', async () => {
    manager.findOne
      .mockResolvedValueOnce({ isDemo: true })
      .mockResolvedValueOnce({ isDemo: false, email: 'ordinary@test.local' });
    await expect(
      policy.assertInquiryActor(2, { userId: 3 } as never)
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('keeps ordinary inquiry creation on its existing path', async () => {
    manager.findOne.mockResolvedValue({ isDemo: false });
    await expect(
      policy.createDemoInquiry(1, { productId: 10 } as never)
    ).resolves.toBeNull();
    expect(ds.transaction).not.toHaveBeenCalled();
  });
  it('ignores client-supplied identity, answer and status fields when creating a demo inquiry', async () => {
    const previousEmail = process.env.DEMO_BUYER_EMAIL;
    process.env.DEMO_BUYER_EMAIL = 'buyer@demo.test';
    manager.findOne.mockResolvedValue({
      id: 2,
      isDemo: true,
      email: 'buyer@demo.test',
    });
    manager.query.mockResolvedValue([{ id: 10, seller_id: 2 }]);
    manager.count.mockResolvedValue(0);
    ds.transaction.mockImplementation((callback) => callback(manager));
    try {
      await policy.createDemoInquiry(1, {
        id: 999,
        userId: 999,
        sellerId: 999,
        status: 'answered',
        answer: 'Injected',
        productId: 10,
        title: 'Test',
        content: 'Test',
        isSecret: false,
      } as never);
      expect(manager.create).toHaveBeenCalledWith(expect.any(Function), {
        userId: 1,
        sellerId: 2,
        productId: 10,
        title: 'Test',
        content: 'Test',
        isSecret: false,
        status: 'waiting',
      });
    } finally {
      if (previousEmail === undefined) delete process.env.DEMO_BUYER_EMAIL;
      else process.env.DEMO_BUYER_EMAIL = previousEmail;
    }
  });
});

describe('demo inquiry indexing transaction', () => {
  const manager = { query: jest.fn(), findOne: jest.fn(), count: jest.fn(), create: jest.fn(), save: jest.fn() };
  const ds = { manager, transaction: jest.fn() };
  const searchJobs = { recordInquiry: jest.fn() };
  let policy: DemoPolicyService;
  let previousEmail: string | undefined;

  beforeEach(() => {
    jest.resetAllMocks();
    previousEmail = process.env.DEMO_BUYER_EMAIL;
    process.env.DEMO_BUYER_EMAIL = 'buyer@demo.test';
    manager.findOne.mockResolvedValue({ id: 2, isDemo: true, email: 'buyer@demo.test' });
    manager.query.mockResolvedValue([{ id: 10, seller_id: 4 }]);
    manager.count.mockResolvedValue(0);
    manager.create.mockImplementation((_entity, value) => value);
    manager.save.mockResolvedValue({ id: 88 });
    ds.transaction.mockImplementation(callback => callback(manager));
    policy = new DemoPolicyService(ds as unknown as DataSource, searchJobs as unknown as SearchIndexRecorder);
  });

  afterEach(() => {
    if (previousEmail === undefined) delete process.env.DEMO_BUYER_EMAIL;
    else process.env.DEMO_BUYER_EMAIL = previousEmail;
  });

  it('records a demo source after saving it with the same transaction manager', async () => {
    await expect(policy.createDemoInquiry(1, { productId: 10, title: '배송 문의', content: '언제 도착하나요?' })).resolves.toEqual({ id: 88 });
    expect(manager.save).toHaveBeenCalledWith(InquiryEntity,
      expect.objectContaining({ userId: 1, sellerId: 2, productId: 10, isSecret: false, status: InquiryStatus.WAITING }));
    expect(searchJobs.recordInquiry).toHaveBeenCalledWith(manager, 88);
    expect(manager.save.mock.invocationCallOrder[0]).toBeLessThan(searchJobs.recordInquiry.mock.invocationCallOrder[0]);
  });

  it('propagates indexing failures so the demo source transaction rolls back', async () => {
    searchJobs.recordInquiry.mockRejectedValue(new Error('PROFILE_MISMATCH'));
    await expect(policy.createDemoInquiry(1, { productId: 10, title: '배송 문의', content: '언제 도착하나요?' })).rejects.toThrow('PROFILE_MISMATCH');
  });

  it('keeps both demo actor lookups on an explicitly supplied source manager', async () => {
    const tx = { findOne: jest.fn().mockResolvedValue({ isDemo: true, email: 'buyer@demo.test' }) };
    await policy.assertInquiryActor(2, { userId: 1 } as InquiryEntity, tx as never);
    expect(tx.findOne).toHaveBeenCalledTimes(2);
    expect(manager.findOne).not.toHaveBeenCalled();
  });
});
