import React from 'react';
import { render } from '@testing-library/react';
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
  it('should render successfully', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { baseElement } = render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>
    );
    expect(baseElement).toBeTruthy();
  });
});
