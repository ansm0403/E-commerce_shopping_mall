import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SellerStatus, type SellerApplication } from '@shopping-mall/shared';
import { useMySellerQuery, useSellerRoleSync, type RoleSyncState } from '../../../../hooks/seller-query-options';
import SellerApplyPage from './page';

/**
 * 셀러 신청 화면의 4분기(미신청 / pending / approved / rejected) 렌더링 (01-seller-core §1-A①).
 *
 * 데이터 훅 두 개만 바꿔 끼운다 — 조회 결과(useMySellerQuery)와 승인 후 토큰 동기화 상태(useSellerRoleSync).
 * 폼·상태 카드·배지는 진짜를 렌더링해 "어떤 데이터에 어떤 화면"인지를 고정한다.
 */
jest.mock('../../../../hooks/seller-query-options', () => ({
  ...jest.requireActual('../../../../hooks/seller-query-options'),
  useMySellerQuery: jest.fn(),
  useSellerRoleSync: jest.fn(),
}));

const mockedQuery = useMySellerQuery as jest.Mock;
const mockedRoleSync = useSellerRoleSync as jest.Mock;

const application = (overrides: Partial<SellerApplication> = {}): SellerApplication => ({
  id: 7,
  createdAt: new Date('2026-09-20T03:00:00.000Z'),
  updatedAt: new Date('2026-09-20T03:00:00.000Z'),
  userId: 42,
  businessName: '쇼핑상회',
  businessNumber: '123-45-67890',
  representativeName: '김쇼핑',
  businessAddress: '서울시 마포구 사업자로 1',
  contactEmail: null,
  contactPhone: null,
  status: SellerStatus.PENDING,
  rejectionReason: null,
  approvedAt: null,
  ...overrides,
});

function renderPage(query: { data?: SellerApplication | null; isLoading?: boolean; isError?: boolean }, roleSync: RoleSyncState = 'idle') {
  const refetch = jest.fn();
  mockedQuery.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch, ...query });
  mockedRoleSync.mockReturnValue(roleSync);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SellerApplyPage />
    </QueryClientProvider>,
  );
  return { refetch };
}

describe('SellerApplyPage — 신청 상태 4분기', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedRoleSync.mockReset();
  });

  it('불러오는 중이면 로딩 문구만', () => {
    renderPage({ isLoading: true });
    expect(screen.getByText('신청 현황을 불러오는 중…')).toBeTruthy();
    expect(screen.queryByText('셀러 신청')).toBeNull();
  });

  it('조회 실패면 "다시 시도" 버튼이 refetch 를 부른다', () => {
    const { refetch } = renderPage({ isError: true });
    expect(screen.getByText('신청 현황을 불러오지 못했습니다.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('미신청(404 → null)이면 빈 신청 폼 — 에러 화면이 아니다', () => {
    renderPage({ data: null });

    expect(screen.getByRole('heading', { name: '셀러 신청' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '신청하기' })).toBeTruthy();
    expect((screen.getByLabelText('상호명') as HTMLInputElement).value).toBe('');
    // 승인 전이라 토큰 동기화는 켜지 않는다
    expect(mockedRoleSync).not.toHaveBeenCalled();
  });

  it('pending 이면 "심사 중" 배지 + 신청 내용, 반려 사유·승인 안내는 없다', () => {
    renderPage({ data: application() });

    expect(screen.getByText('심사 중')).toBeTruthy();
    expect(screen.getByText('쇼핑상회')).toBeTruthy();
    expect(screen.getByText('123-45-67890')).toBeTruthy();
    expect(screen.queryByText('반려 사유')).toBeNull();
    expect(screen.queryByText('다시 신청하기')).toBeNull();
    expect(screen.queryByText(/셀러 권한/)).toBeNull();
    // approved 가 아니므로 refresh 1회 트리거는 꺼진 채 호출된다
    expect(mockedRoleSync).toHaveBeenCalledWith(false);
  });

  describe('approved — 승인은 DB 역할만 바꾸므로 손에 든 토큰을 refresh 1회로 맞추는 과정을 보여준다', () => {
    const approved = application({ status: SellerStatus.APPROVED, approvedAt: '2026-09-21T01:00:00.000Z' });

    it('syncing 이면 적용 중 안내', () => {
      renderPage({ data: approved }, 'syncing');

      expect(screen.getByText('승인')).toBeTruthy();
      expect(screen.getByText('셀러 권한을 적용하는 중입니다…')).toBeTruthy();
      expect(mockedRoleSync).toHaveBeenCalledWith(true);
    });

    it('synced 면 셀러 기능으로 가는 링크', () => {
      renderPage({ data: approved }, 'synced');

      expect(screen.getByText(/셀러 권한이 적용되었습니다/)).toBeTruthy();
      expect(screen.getByRole('link', { name: '상품 등록하러 가기' }).getAttribute('href')).toBe('/seller/products/new');
      expect(screen.getByRole('link', { name: '셀러 홈' }).getAttribute('href')).toBe('/seller');
    });

    it('failed 면 재로그인 안내 — 루프를 돌지 않고 사용자에게 넘긴다', () => {
      renderPage({ data: approved }, 'failed');

      expect(screen.getByText(/셀러 권한이 아직 반영되지 않았습니다/)).toBeTruthy();
      expect(screen.getByRole('link', { name: '다시 로그인하기' }).getAttribute('href')).toBe('/login');
      expect(screen.queryByText('상품 등록하러 가기')).toBeNull();
    });
  });

  describe('rejected', () => {
    it('반려 사유를 보여주고, "다시 신청하기"를 누르면 이전 내용이 채워진 재신청 폼으로 바뀐다', () => {
      renderPage({
        data: application({
          status: SellerStatus.REJECTED,
          rejectionReason: '사업자등록증의 상호와 입력한 상호명이 다릅니다.',
        }),
      });

      expect(screen.getByText('반려')).toBeTruthy();
      expect(screen.getByText('사업자등록증의 상호와 입력한 상호명이 다릅니다.')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: '다시 신청하기' }));

      expect(screen.getByRole('heading', { name: '셀러 재신청' })).toBeTruthy();
      expect((screen.getByLabelText('상호명') as HTMLInputElement).value).toBe('쇼핑상회');
      expect((screen.getByLabelText('사업자 등록번호') as HTMLInputElement).value).toBe('123-45-67890');
      // 은행 정보는 응답에 @Exclude 라 비어 있다 — 재신청 때 다시 입력받는다
      expect((screen.getByLabelText('은행명') as HTMLInputElement).value).toBe('');
    });

    it('사유가 기록되지 않았으면 대체 문구', () => {
      renderPage({ data: application({ status: SellerStatus.REJECTED, rejectionReason: null }) });

      expect(screen.getByText('사유가 기록되지 않았습니다.')).toBeTruthy();
    });
  });
});
