import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as PortOne from '@portone/browser-sdk/v2';
import CheckoutPage from './page';
import { getMyCart } from '../../../service/cart';
import {
  createDemoCheckout,
  getDemoCheckoutOptions,
} from '../../../service/demo-checkout';
import { cancelOrder, createOrder } from '../../../service/order';

const push = jest.fn();
const verify = jest.fn();
let demo = true;
let revision = 'initial';
jest.mock('../../../service/auth-session', () => ({
  authRevision: () => revision,
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: jest.fn() }),
}));
jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, isDemo: demo, roles: ['buyer'] },
    isHydrated: true,
  }),
}));
jest.mock('../../../hooks/useRequireAuth', () => ({
  useRequireAuth: jest.fn(),
}));
jest.mock('../../../hooks/useOrder', () => ({
  useVerifyPayment: () => ({ mutateAsync: verify, isPending: false }),
}));
jest.mock('../../../service/cart', () => ({ getMyCart: jest.fn() }));
jest.mock('../../../service/order', () => ({
  createOrder: jest.fn(),
  cancelOrder: jest.fn(),
}));
jest.mock('../../../service/demo-checkout', () => ({
  createDemoCheckout: jest.fn(),
  getDemoCheckoutOptions: jest.fn(),
}));
jest.mock('@portone/browser-sdk/v2', () => ({ requestPayment: jest.fn() }));

const order = {
  id: 1,
  isDemoCheckout: true,
  orderNumber: 'DEMO-PG-test',
  status: 'pending_payment',
  totalAmount: 7000,
  recipientName: 'Test buyer',
  recipientPhone: '010-0000-0000',
  shippingAddress: 'Test only',
  testPayment: {
    storeId: 'server-test-store',
    channelKey: 'server-test-channel',
  },
  items: [{ id: 1, productId: 1, productName: 'Server snapshot', quantity: 1 }],
};

describe('Buyer demo checkout UI', () => {
  let client: QueryClient;
  beforeEach(() => {
    jest.clearAllMocks();
    demo = true;
    revision = 'initial';
    jest.spyOn(window, 'alert').mockImplementation(() => undefined);
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    jest.mocked(getMyCart).mockResolvedValue({
      data: {
        items: [
          {
            id: 1,
            quantity: 1,
            product: {
              name: 'Cart product',
              brand: 'Test',
              price: 1000,
              status: 'published',
              stockQuantity: 10,
            },
          },
        ],
      },
    } as never);
    jest.mocked(getDemoCheckoutOptions).mockResolvedValue({
      data: {
        enabled: true,
        shipping: {
          recipientName: order.recipientName,
          recipientPhone: order.recipientPhone,
          shippingAddress: order.shippingAddress,
        },
      },
    } as never);
    jest.mocked(createDemoCheckout).mockResolvedValue({ data: order } as never);
    jest
      .mocked(cancelOrder)
      .mockResolvedValue({ data: { ...order, status: 'cancelled' } } as never);
    jest.mocked(PortOne.requestPayment).mockResolvedValue({
      paymentId: order.orderNumber,
      txId: 'tx-test',
    } as never);
    verify.mockResolvedValue({});
  });
  afterEach(() => {
    client.clear();
    jest.restoreAllMocks();
  });
  async function mount() {
    render(
      <QueryClientProvider client={client}>
        <CheckoutPage />
      </QueryClientProvider>
    );
    return screen.findByRole('button', { name: '테스트 결제하기' });
  }
  it('uses only server TEST settings, snapshotted items and amount, with fixed shipping', async () => {
    const button = await mount();
    await waitFor(() =>
      expect((screen.getByLabelText(/수령인/) as HTMLInputElement).value).toBe(
        order.recipientName
      )
    );
    expect((screen.getByLabelText(/수령인/) as HTMLInputElement).readOnly).toBe(
      true
    );
    fireEvent.click(button);
    await waitFor(() =>
      expect(verify).toHaveBeenCalledWith({
        paymentId: order.orderNumber,
        transactionId: 'tx-test',
      })
    );
    expect(createOrder).not.toHaveBeenCalled();
    expect(createDemoCheckout).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9-]{36}$/)
    );
    expect(PortOne.requestPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        ...order.testPayment,
        totalAmount: 7000,
        orderName: 'Server snapshot',
      })
    );
  });
  it('blocks checkout when the TEST channel is disabled', async () => {
    jest
      .mocked(getDemoCheckoutOptions)
      .mockResolvedValue({ data: { enabled: false } } as never);
    const button = await mount();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(createDemoCheckout).not.toHaveBeenCalled();
    expect(PortOne.requestPayment).not.toHaveBeenCalled();
    expect(
      screen.getByRole('link', { name: '준비된 배송·리뷰 주문 체험하기' })
    ).toBeDefined();
  });
  it('fails closed instead of using normal environment keys when TEST settings are missing', async () => {
    jest.mocked(createDemoCheckout).mockResolvedValue({
      data: { ...order, testPayment: undefined },
    } as never);
    fireEvent.click(await mount());
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(PortOne.requestPayment).not.toHaveBeenCalled();
  });
  it('cancels the pending demo order when the payment window closes', async () => {
    jest.mocked(PortOne.requestPayment).mockResolvedValue(undefined);
    fireEvent.click(await mount());
    await waitFor(() =>
      expect(cancelOrder).toHaveBeenCalledWith(order.orderNumber)
    );
    expect(verify).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(`/my/orders/${order.orderNumber}`);
  });
  it('rejects a payment response belonging to another order', async () => {
    jest.mocked(PortOne.requestPayment).mockResolvedValue({
      paymentId: 'other-order',
      txId: 'tx-test',
    } as never);
    fireEvent.click(await mount());
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(verify).not.toHaveBeenCalled();
  });
  it('disables submitting throughout the SDK window and prevents double submits', async () => {
    let finish!: (value: undefined) => void;
    jest.mocked(PortOne.requestPayment).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const button = await mount();
    const form = button.closest('form');
    if (!form) throw new Error('Checkout form missing');
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() =>
      expect(PortOne.requestPayment).toHaveBeenCalledTimes(1)
    );
    expect(createDemoCheckout).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole('button', { name: '처리 중...' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    finish(undefined);
    await waitFor(() => expect(cancelOrder).toHaveBeenCalled());
  });
  it.each(['success', 'closed'])(
    'ignores an old SDK %s result after switching accounts',
    async (result) => {
      let finish: (value: unknown) => void = () => undefined;
      jest.mocked(PortOne.requestPayment).mockReturnValue(
        new Promise((resolve) => {
          finish = resolve as typeof finish;
        })
      );
      fireEvent.click(await mount());
      await waitFor(() => expect(PortOne.requestPayment).toHaveBeenCalled());
      revision = 'next-account';
      finish(
        result === 'success'
          ? { paymentId: order.orderNumber, txId: 'tx-test' }
          : undefined
      );
      await waitFor(() =>
        expect(
          (
            screen.getByRole('button', {
              name: '테스트 결제하기',
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false)
      );
      expect(verify).not.toHaveBeenCalled();
      expect(cancelOrder).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
      expect(window.alert).not.toHaveBeenCalled();
    }
  );
  it('preserves ordinary checkout through the existing order endpoint', async () => {
    demo = false;
    jest.mocked(createOrder).mockResolvedValue({
      data: {
        ...order,
        isDemoCheckout: undefined,
        testPayment: undefined,
        orderNumber: 'ORD-normal',
      },
    } as never);
    jest.mocked(PortOne.requestPayment).mockResolvedValue({
      paymentId: 'ORD-normal',
      txId: 'tx-normal',
    } as never);
    render(
      <QueryClientProvider client={client}>
        <CheckoutPage />
      </QueryClientProvider>
    );
    const button = await screen.findByRole('button', { name: '결제하기' });
    fireEvent.change(screen.getByLabelText(/수령인/), {
      target: { value: 'Buyer' },
    });
    fireEvent.change(screen.getByLabelText(/연락처/), {
      target: { value: '01012345678' },
    });
    fireEvent.change(screen.getByLabelText(/배송지 주소/), {
      target: { value: 'Address' },
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(verify).toHaveBeenCalledWith({
        paymentId: 'ORD-normal',
        transactionId: 'tx-normal',
      })
    );
    expect(createDemoCheckout).not.toHaveBeenCalled();
    expect(createOrder).toHaveBeenCalled();
  });
});
