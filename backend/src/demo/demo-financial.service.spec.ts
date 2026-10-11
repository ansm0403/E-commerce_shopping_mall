import { DemoPolicyService } from './demo-policy.service';
import { PaymentService } from '../payment/payment.service';
import { PaymentStatus } from '../payment/entity/payment.entity';
import { SettlementService } from '../settlement/settlement.service';

describe('Synthetic financial targets', () => {
  const manager = { findOne: jest.fn(), update: jest.fn() };
  const ds = {
    manager,
    transaction: async (callback: (manager: unknown) => unknown) =>
      callback(manager),
  };
  const http = { get: jest.fn(), post: jest.fn() };
  const repository = { findOne: jest.fn(), save: jest.fn() };
  let payment: PaymentService;
  let settlement: SettlementService;
  beforeEach(() => {
    jest.clearAllMocks();
    const policy = new DemoPolicyService(ds as never);
    manager.findOne.mockResolvedValue({
      id: 7,
      orderId: 3,
      orderNumber: 'DEMO',
      status: 'preparing',
    });
    repository.findOne.mockResolvedValue({
      id: 5,
      orderId: 3,
      status: 'pending',
    });
    payment = new PaymentService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      ds as never,
      http as never,
      {} as never,
      { emit: jest.fn() } as never,
      policy
    );
    settlement = new SettlementService(
      repository as never,
      {} as never,
      policy
    );
  });
  it('blocks an ordinary admin refund before any PG request or stock update', async () => {
    await expect(
      payment.cancelPaymentByAdmin('DEMO', { reason: 'test' })
    ).rejects.toMatchObject({ status: 403 });
    expect(http.post).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
  });
  it.each(['confirmSettlement', 'markAsPaid'] as const)(
    'blocks %s even when invoked without a demo actor',
    async (method) => {
      await expect(settlement[method](5)).rejects.toMatchObject({
        status: 403,
      });
      expect(repository.save).not.toHaveBeenCalled();
    }
  );
  it.each([PaymentStatus.READY, PaymentStatus.FAILED, PaymentStatus.PAID])(
    'ignores synthetic webhooks in state %s without an external call',
    async (status) => {
      repository.findOne.mockResolvedValue({ id: 5, orderId: 3, status });
      expect(
        await payment.handleWebhook({
          type: 'Transaction.Paid',
          data: { paymentId: 'DEMO' },
        } as never)
      ).toEqual({ message: 'synthetic demo payment ignored' });
      expect(http.get).not.toHaveBeenCalled();
      expect(http.post).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
    }
  );
});
