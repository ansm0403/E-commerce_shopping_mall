import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { useCreateInquiry } from '../../hooks/useInquiry';
import InquiryForm from './InquiryForm';

/**
 * 상품 문의 작성 폼의 상태별 분기와 제출 (05-buyer-flow-complete §6 ②).
 *
 * 인증 상태(useAuth)와 작성 mutation(useCreateInquiry)만 바꿔 끼우고, 폼·검증(zod)·문구는 진짜를 렌더링한다.
 */
jest.mock('next/navigation', () => ({ usePathname: jest.fn() }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../hooks/useInquiry', () => ({ useCreateInquiry: jest.fn() }));

const mockedAuth = useAuth as jest.Mock;
const mutateAsync = jest.fn();

const auth = (state: { user?: object | null; isHydrated?: boolean; isLoading?: boolean }) =>
  mockedAuth.mockReturnValue({ user: null, isHydrated: true, isLoading: false, ...state });
const buyer = { id: 1, roles: [{ name: 'buyer' }] };

const title = () => screen.getByLabelText('제목') as HTMLInputElement;
const content = () => screen.getByLabelText('내용') as HTMLTextAreaElement;
const secret = () => screen.getByRole('checkbox') as HTMLInputElement;
const submit = () => fireEvent.click(screen.getByRole('button', { name: '문의 등록' }));

describe('InquiryForm', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    (usePathname as jest.Mock).mockReturnValue('/products/521');
    (useCreateInquiry as jest.Mock).mockReturnValue({ mutateAsync });
  });

  describe('상태별 분기', () => {
    it('인증 확인 중에는 아무것도 그리지 않는다(로그인 안내가 번쩍이지 않게)', () => {
      auth({ isLoading: true });
      const { container } = render(<InquiryForm productId={521} />);
      expect(container.innerHTML).toBe('');
    });

    it('비로그인이면 폼 대신 로그인 링크 — 돌아올 경로가 실린다', () => {
      auth({ user: null });
      render(<InquiryForm productId={521} />);

      const link = screen.getByRole('link', { name: '로그인' });
      expect(link.getAttribute('href')).toBe('/login?redirect=%2Fproducts%2F521');
      expect(screen.queryByRole('button', { name: '문의 등록' })).toBeNull();
    });

    it('구매자 역할이 없으면(관리자 전용 계정 등) 안내 한 줄', () => {
      auth({ user: { id: 2, roles: [{ name: 'admin' }] } });
      render(<InquiryForm productId={521} />);

      expect(screen.getByText('문의는 구매자 계정으로만 남길 수 있습니다.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: '문의 등록' })).toBeNull();
    });

    it('구매자면 폼', () => {
      auth({ user: buyer });
      render(<InquiryForm productId={521} />);

      expect(screen.getByRole('heading', { name: '문의하기' })).toBeTruthy();
      expect(title().value).toBe('');
      expect(secret().checked).toBe(false);
    });
  });

  describe('제출', () => {
    beforeEach(() => auth({ user: buyer }));

    it('비어 있으면 검증 문구를 보이고 서버를 부르지 않는다', async () => {
      render(<InquiryForm productId={521} />);
      submit();

      expect(await screen.findByText('제목은 2자 이상 입력해주세요.')).toBeTruthy();
      expect(screen.getByText('문의 내용을 입력해주세요.')).toBeTruthy();
      expect(mutateAsync).not.toHaveBeenCalled();
      // 틀린 칸이 스크린리더에도 틀렸다고 전달된다
      expect(title().getAttribute('aria-invalid')).toBe('true');
    });

    it('입력값을 상품 번호와 함께 보내고, 성공하면 폼을 비우고 완료 문구를 띄운다', async () => {
      mutateAsync.mockResolvedValue({ id: 1 });
      render(<InquiryForm productId={521} />);

      fireEvent.change(title(), { target: { value: '  배송 문의  ' } });
      fireEvent.change(content(), { target: { value: '며칠 걸리나요?' } });
      fireEvent.click(secret());
      submit();

      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
      // 앞뒤 공백은 걷어 내고 보낸다
      expect(mutateAsync).toHaveBeenCalledWith({
        productId: 521,
        title: '배송 문의',
        content: '며칠 걸리나요?',
        isSecret: true,
      });

      expect(await screen.findByText('문의가 등록되었습니다.')).toBeTruthy();
      await waitFor(() => expect(title().value).toBe(''));
      expect(content().value).toBe('');
      expect(secret().checked).toBe(false);
    });

    it('서버가 거절하면 그 문구를 폼에 보이고 입력은 남겨 둔다', async () => {
      mutateAsync.mockRejectedValue(new Error('network'));
      render(<InquiryForm productId={521} />);

      fireEvent.change(title(), { target: { value: '배송 문의' } });
      fireEvent.change(content(), { target: { value: '며칠 걸리나요?' } });
      submit();

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe('처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      expect(title().value).toBe('배송 문의');
      expect(screen.queryByText('문의가 등록되었습니다.')).toBeNull();
    });
  });
});
