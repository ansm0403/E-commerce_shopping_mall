import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal, ModalFooter } from './Modal';

/**
 * 공용 Modal 의 키보드 포커스 규칙(docs/roadmap/ex-a11y-bundle.md §2).
 * 수정 전 실측: 열어도 포커스가 뒤 페이지에 남고, Tab 8회가 전부 모달 뒤 푸터로 새고, 닫은 뒤 제자리를 잃었다.
 * 그 네 가지(이름·이동·가두기·복귀)를 고정한다. Esc 닫기는 원래 되던 것 — 회귀만 막는다.
 */
function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>주문 취소</button>
      <a href="#footer">뒤 페이지 링크</a>
      <Modal
        isOpen={open}
        title="주문 취소"
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
      >
        <p>정말 취소할까요?</p>
        <ModalFooter>
          <button onClick={() => setOpen(false)}>돌아가기</button>
          <button>취소하기</button>
        </ModalFooter>
      </Modal>
    </>
  );
}

function openModal() {
  const opener = screen.getByRole('button', { name: '주문 취소' });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe('Modal 포커스', () => {
  it('대화상자 이름은 보이는 제목과 연결된다', () => {
    render(<Harness />);
    openModal();
    expect(screen.getByRole('dialog', { name: '주문 취소' })).toBeTruthy();
  });

  it('열리면 포커스가 모달 안(닫기 버튼 다음 첫 요소)으로 들어간다', () => {
    render(<Harness />);
    openModal();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '돌아가기' }));
  });

  it('마지막 요소에서 Tab 은 처음으로, 처음에서 Shift+Tab 은 마지막으로 돈다', () => {
    render(<Harness />);
    openModal();
    const close = screen.getByRole('button', { name: '닫기' });
    const last = screen.getByRole('button', { name: '취소하기' });

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('포커스가 모달 밖에 있어도 Tab 은 모달 안으로 되돌린다', () => {
    render(<Harness />);
    openModal();
    screen.getByText('뒤 페이지 링크').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('Esc 로 닫히고, 포커스가 연 버튼으로 돌아온다', () => {
    const onClose = jest.fn();
    render(<Harness onClose={onClose} />);
    const opener = openModal();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
