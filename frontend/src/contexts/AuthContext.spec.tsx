import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DemoRole } from '@shopping-mall/shared';
import AuthContextProvider, { useAuth } from './AuthContext';
import DemoAccountChoice from '../components/forms/DemoAccountChoice';
import NavbarUserSection from '../components/header/navbar/NavbarUserSection';
import UserMenu from '../components/header/topbar/UserMenu';
import { login, verifyEmail } from '../service/auth';
import { authRevision } from '../service/auth-session';
import { authStorage } from '../service/auth-storage';
import {
  authClient,
  publicClient,
  resetLoggingOutFlag,
} from '../lib/axios/axios-http-client';
import * as queryClients from '../lib/react-query/get-query-client';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('../service/auth-channel', () => ({ getAuthChannel: () => null }));
jest.mock('../lib/react-query/get-query-client', () => ({
  getQueryClient: jest.fn(),
}));
jest.mock('../lib/axios/report-api-error', () => ({
  reportApiError: jest.fn(),
}));

const user = (role: DemoRole) => ({
  id: role === 'buyer' ? 1 : role === 'seller' ? 2 : 3,
  email: `${role}@demo.local`,
  name: role,
  nickName: role,
  roles: role === 'seller' ? ['buyer', 'seller'] : [role],
  isDemo: true,
});

function AuthStatus() {
  const { user, isLoading, logoutRedirect } = useAuth();
  return (
    <output data-testid="auth-status" data-logout-target={logoutRedirect ?? ''}>
      {isLoading ? 'loading' : user?.email ?? 'anonymous'}
    </output>
  );
}

function RoleChoiceLogout() {
  const { logout } = useAuth();
  return <button onClick={() => void logout('/login#demo-choice')}>Switch demo role</button>;
}

describe('Mounted authentication state', () => {
  let client: QueryClient;
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetLoggingOutFlag();
    push.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    jest.mocked(queryClients.getQueryClient).mockReturnValue(client);
    jest.spyOn(publicClient, 'get').mockResolvedValue({
      data: {
        enabled: true,
        roles: { buyer: true, seller: true, admin: true },
      },
    });
    jest.spyOn(publicClient, 'post').mockImplementation(
      async (path, data) =>
        ({
          data:
            path === '/auth/demo-login' || path === '/auth/login'
              ? {
                  accessToken: 'demo-token',
                  user: user((data as { role?: DemoRole }).role ?? 'buyer'),
                }
              : { message: 'logged out' },
        } as never)
    );
  });
  afterEach(() => {
    client.clear();
    jest.restoreAllMocks();
  });

  function mount() {
    return render(
      <QueryClientProvider client={client}>
        <AuthContextProvider>
          <AuthStatus />
          <RoleChoiceLogout />
          <NavbarUserSection />
          <UserMenu />
          <DemoAccountChoice
            busy={false}
            onStart={jest.fn()}
            onError={jest.fn()}
          />
        </AuthContextProvider>
      </QueryClientProvider>
    );
  }

  it.each([
    ['buyer', '구매자 체험', '/my/orders'],
    ['seller', '셀러 체험', '/seller'],
    ['admin', '관리자 체험', '/admin/dashboard'],
  ] as const)(
    'updates the header and redirects after %s login without a reload',
    async (role, label, destination) => {
      mount();
      await waitFor(() =>
        expect(screen.getByTestId('auth-status').textContent).toBe('anonymous')
      );
      const button = screen.getByRole('button', {
        name: new RegExp(`^${label}`),
      });
      await waitFor(() =>
        expect((button as HTMLButtonElement).disabled).toBe(false)
      );
      fireEvent.click(button);
      await waitFor(() => expect(push).toHaveBeenCalledWith(destination));
      await waitFor(() =>
        expect(screen.getByTestId('auth-status').textContent).toBe(
          `${role}@demo.local`
        )
      );
      expect(
        screen.queryByRole('button', { name: '로그인/회원가입' })
      ).toBeNull();
      expect(screen.getByRole('button', { name: '로그아웃' })).toBeTruthy();
      expect(screen.getByRole('button', { name: `${role}님` })).toBeTruthy();
    }
  );

  it('updates the mounted header after logout without a reload', async () => {
    authStorage.setAccessToken('buyer-token', false);
    client.setQueryData(['auth', 'user'], user('buyer'));
    jest.spyOn(authClient, 'get').mockResolvedValue({ data: user('buyer') });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '로그아웃' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
    await waitFor(() =>
      expect(screen.getByTestId('auth-status').textContent).toBe('anonymous')
    );
    expect(screen.queryByRole('button', { name: '로그아웃' })).toBeNull();
    expect(
      screen.getByRole('button', { name: '로그인/회원가입' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'buyer님' })).toBeNull();
  });

  it('keeps an explicit logout destination until a new login clears it', async () => {
    authStorage.setAccessToken('buyer-token', false);
    client.setQueryData(['auth', 'user'], user('buyer'));
    jest.spyOn(authClient, 'get').mockResolvedValue({ data: user('buyer') });
    mount();
    await screen.findByRole('button', { name: 'buyer님' });
    fireEvent.click(screen.getByRole('button', { name: 'Switch demo role' }));
    await waitFor(() => expect(screen.getByTestId('auth-status').textContent).toBe('anonymous'));
    expect(screen.getByTestId('auth-status').getAttribute('data-logout-target')).toBe('/login#demo-choice');
    await act(async () => {
      await login({ email: 'buyer@demo.local', password: 'test-password', rememberMe: false });
    });
    await screen.findByRole('button', { name: 'buyer님' });
    await waitFor(() => expect(screen.getByTestId('auth-status').getAttribute('data-logout-target')).toBe(''));
  });

  it('switches buyer to seller through logout without remounting the provider', async () => {
    mount();
    const buyerButton = screen.getByRole('button', { name: /^구매자 체험/ });
    await waitFor(() =>
      expect((buyerButton as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(buyerButton);
    await screen.findByRole('button', { name: 'buyer님' });
    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));
    await waitFor(() =>
      expect(screen.getByTestId('auth-status').textContent).toBe('anonymous')
    );
    const sellerButton = screen.getByRole('button', { name: /^셀러 체험/ });
    await waitFor(() =>
      expect((sellerButton as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(sellerButton);
    await screen.findByRole('button', { name: 'seller님' });
    expect(screen.queryByRole('button', { name: 'buyer님' })).toBeNull();
  });

  it.each(['login', 'verify-email'])(
    'updates the mounted provider after ordinary %s',
    async (mode) => {
      mount();
      await waitFor(() =>
        expect(screen.getByTestId('auth-status').textContent).toBe('anonymous')
      );
      if (mode === 'login') {
        await act(async () => {
          await login({
            email: 'buyer@demo.local',
            password: 'test-password',
            rememberMe: false,
          });
        });
      } else {
        jest.mocked(publicClient.get).mockResolvedValue({
          data: { accessToken: 'verified-token', user: user('buyer') },
        });
        await act(async () => {
          await verifyEmail('verification-token');
        });
      }
      await screen.findByRole('button', { name: 'buyer님' });
    }
  );

  it('updates the user when another tab changes a persistent account', async () => {
    authStorage.setAccessToken('buyer-token', true);
    client.setQueryData(['auth', 'user'], user('buyer'));
    jest.spyOn(authClient, 'get').mockResolvedValue({ data: user('seller') });
    mount();
    await screen.findByRole('button', { name: 'buyer님' });
    act(() => {
      authStorage.setAccessToken('seller-token', true);
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'auth:revision',
          newValue: authRevision(),
        })
      );
    });
    await screen.findByRole('button', { name: 'seller님' });
    expect(screen.queryByRole('button', { name: 'buyer님' })).toBeNull();
  });

  it('updates logout received through storage even without BroadcastChannel', async () => {
    authStorage.setAccessToken('buyer-token', true);
    client.setQueryData(['auth', 'user'], user('buyer'));
    mount();
    await screen.findByRole('button', { name: 'buyer님' });
    act(() => {
      authStorage.clearToken();
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'auth:revision',
          newValue: authRevision(),
        })
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId('auth-status').textContent).toBe('anonymous')
    );
    expect(screen.queryByRole('button', { name: 'buyer님' })).toBeNull();
  });

  it('ignores an old pending profile response after a demo login', async () => {
    let resolve!: (reply: { data: ReturnType<typeof user> }) => void;
    const reply = new Promise<{ data: ReturnType<typeof user> }>((done) => {
      resolve = done;
    });
    authStorage.setAccessToken('buyer-token', false);
    const get = jest.spyOn(authClient, 'get').mockReturnValue(reply as never);
    mount();
    await waitFor(() => expect(get).toHaveBeenCalled());
    const button = screen.getByRole('button', { name: /^셀러 체험/ });
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(button);
    await screen.findByRole('button', { name: 'seller님' });
    await act(async () => {
      resolve({ data: user('buyer') });
      await reply;
    });
    expect(screen.getByTestId('auth-status').textContent).toBe(
      'seller@demo.local'
    );
    expect(screen.queryByRole('button', { name: 'buyer님' })).toBeNull();
  });
});
