import { DemoInquiryRateGuard } from './demo-inquiry-rate.guard';

describe('Demo inquiry IP limit', () => {
  const redis = { checkRateLimit: jest.fn() };
  const context = (isDemo: boolean) => ({
    switchToHttp: () => ({
      getRequest: () => ({ user: { isDemo }, ip: '127.0.0.1' }),
    }),
  });
  beforeEach(() => jest.clearAllMocks());
  it('preserves ordinary buyers existing limit', async () => {
    await expect(
      new DemoInquiryRateGuard(redis as never).canActivate(
        context(false) as never
      )
    ).resolves.toBe(true);
    expect(redis.checkRateLimit).not.toHaveBeenCalled();
  });
  it('limits authenticated demo buyers to five inquiries per minute', async () => {
    redis.checkRateLimit.mockResolvedValue(false);
    await expect(
      new DemoInquiryRateGuard(redis as never).canActivate(
        context(true) as never
      )
    ).rejects.toMatchObject({ status: 429 });
    expect(redis.checkRateLimit).toHaveBeenCalledWith(
      'demo-inquiry:127.0.0.1',
      5,
      60
    );
  });
});
