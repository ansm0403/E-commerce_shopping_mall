import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { Role } from '../user/entity/role.entity';
jest.mock('bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));

describe('Demo authentication validates the configured account before issuing tokens', () => {
  const users = { findOne: jest.fn() };
  const redis = {
    checkRateLimit: jest.fn(),
    getLoginAttempts: jest.fn(),
    incrementLoginAttempts: jest.fn(),
    resetLoginAttempts: jest.fn(),
  };
  const policy = { approvedSeller: jest.fn() };
  const context = { ipAddress: '127.0.0.1' };
  let service: AuthService;
  const config: Record<string, string> = {
    DEMO_LOGIN_ENABLED: 'true',
    DEMO_BUYER_EMAIL: 'buyer@demo.test',
    DEMO_BUYER_PASSWORD: 'configured',
    DEMO_SELLER_EMAIL: 'seller@demo.test',
    DEMO_SELLER_PASSWORD: 'configured',
    DEMO_ADMIN_EMAIL: 'admin@demo.test',
    DEMO_ADMIN_PASSWORD: 'configured',
  };
  beforeEach(() => {
    jest.clearAllMocks();
    redis.checkRateLimit.mockResolvedValue(true);
    redis.getLoginAttempts.mockResolvedValue(50);
    policy.approvedSeller.mockResolvedValue({ id: 1 });
    service = new AuthService(
      {} as never,
      { get: (key: string) => config[key] } as never,
      redis as never,
      { log: jest.fn() } as never,
      {} as never,
      users as never,
      {} as never,
      {} as never,
      policy as never
    );
  });
  const buyer = {
    id: 1,
    isDemo: true,
    isEmailVerified: true,
    password: 'hash',
    roles: [{ name: Role.BUYER }],
  };
  it.each([
    null,
    { ...buyer, isDemo: false },
    { ...buyer, isEmailVerified: false },
    { ...buyer, roles: [{ name: Role.ADMIN }] },
    { ...buyer, roles: [{ name: Role.BUYER }, { name: Role.ADMIN }] },
  ])('rejects missing, ordinary or mismatched demo buyer: %p', async (user) => {
    users.findOne.mockResolvedValue(user);
    await expect(service.demoLogin(context, 'buyer')).rejects.toMatchObject({
      status: 403,
    });
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(redis.incrementLoginAttempts).not.toHaveBeenCalled();
  });
  it('does not lock the shared account when its configured password is wrong', async () => {
    users.findOne.mockResolvedValue(buyer);
    jest.mocked(bcrypt.compare).mockResolvedValue(false as never);
    await expect(service.demoLogin(context, 'buyer')).rejects.toMatchObject({
      status: 403,
    });
    expect(redis.incrementLoginAttempts).not.toHaveBeenCalled();
  });
  it('rejects an unapproved demo seller before checking the password', async () => {
    users.findOne.mockResolvedValue({
      ...buyer,
      roles: [{ name: Role.BUYER }, { name: Role.SELLER }],
    });
    policy.approvedSeller.mockResolvedValue(null);
    await expect(service.demoLogin(context, 'seller')).rejects.toMatchObject({
      status: 403,
    });
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });
  it('returns only cached availability and never publicly compares passwords', async () => {
    users.findOne.mockImplementation(async ({ where: { email } }) => ({
      ...buyer,
      roles: email.startsWith('seller')
        ? [{ name: Role.BUYER }, { name: Role.SELLER }]
        : email.startsWith('admin')
        ? [{ name: Role.ADMIN }]
        : buyer.roles,
    }));
    expect(await service.demoOptions()).toEqual({
      enabled: true,
      roles: { buyer: true, seller: true, admin: true },
    });
    await service.demoOptions();
    expect(users.findOne).toHaveBeenCalledTimes(3);
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('rechecks disabled configuration at login even while availability is cached', async () => {
    let now = 1000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    users.findOne.mockResolvedValue(buyer);
    const previous = config.DEMO_LOGIN_ENABLED;
    try {
      expect((await service.demoOptions()).roles.buyer).toBe(true);
      config.DEMO_LOGIN_ENABLED = 'false';
      await expect(service.demoLogin(context, 'buyer')).rejects.toMatchObject({
        status: 403,
      });
      now = 5999;
      expect((await service.demoOptions()).roles.buyer).toBe(true);
      now = 6000;
      expect(await service.demoOptions()).toEqual({
        enabled: false,
        roles: { buyer: false, seller: false, admin: false },
      });
      expect(bcrypt.compare).not.toHaveBeenCalled();
    } finally {
      config.DEMO_LOGIN_ENABLED = previous;
      clock.mockRestore();
    }
  });
});
