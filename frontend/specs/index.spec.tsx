import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Page from '../src/app/(main)/page';

// 홈(`/`)은 (main) 라우트 그룹 아래에 있고, 상품·카테고리 섹션이 TanStack Query 로 API 를 부르므로
// Provider 를 씌우고 HTTP 클라이언트는 막는다(jsdom 에서 실제 소켓을 열면 Jest 가 종료를 기다린다).
jest.mock('../src/lib/axios/axios-http-client', () => {
  const pending = () => new Promise(() => undefined);
  const client = { get: jest.fn(pending), post: jest.fn(pending), patch: jest.fn(pending), delete: jest.fn(pending) };
  return { publicClient: client, authClient: client };
});

describe('Page', () => {
  const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');

  beforeAll(() => {
    // jsdom에는 matchMedia가 없다. 실제 배너를 렌더링하되 브라우저 API만 제공한다.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: jest.fn((media: string) => ({
        matches: false,
        media,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(() => true),
      })),
    });
  });

  afterAll(() => {
    if (matchMediaDescriptor) Object.defineProperty(window, 'matchMedia', matchMediaDescriptor);
    else Reflect.deleteProperty(window, 'matchMedia');
  });

  it('should render successfully', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { baseElement } = render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>
    );
    expect(baseElement).toBeTruthy();
    expect(screen.getByRole('region', { name: '쇼핑 배너' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '다음 배너' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '지금 많이 찾는 상품' })).toBeTruthy();
  });
});
