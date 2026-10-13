import { act, render, screen } from '@testing-library/react';
import AssistantChat from './AssistantChat';
import { useAssistantStream } from '../hooks/useAssistantStream';
import type { ChatMessage } from '../lib/chat-message';

jest.mock('../hooks/useAssistantStream', () => ({ useAssistantStream: jest.fn() }));
jest.mock('./MessageList', () => ({ __esModule: true, default: () => null }));
jest.mock('./Composer', () => ({ __esModule: true, default: () => null }));

const mockUseAssistantStream = jest.mocked(useAssistantStream);
const reply = (over: Partial<ChatMessage> = {}): ChatMessage => ({ role: 'assistant', content: '', ...over });

function setStream(message: ChatMessage | undefined, streaming: boolean, error: string | null = null) {
  mockUseAssistantStream.mockReturnValue({
    messages: message ? [message] : [], streaming, error,
    send: jest.fn(), stop: jest.fn(), newChat: jest.fn(),
  });
}

describe('AssistantChat — 실패 뒤 접근성 상태 정리', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });
  afterEach(() => jest.useRealTimers());

  it('조회 후 실패하면 이전 조회 중 알림을 비우고 오류만 alert로 전달한다', () => {
    setStream(reply({ tools: [{ name: 'summarize_reviews', status: 'running' }] }), true);
    const { rerender } = render(<AssistantChat />);
    expect(screen.getByRole('status').textContent).toBe('리뷰 조회 중');

    setStream(reply({ tools: [{ name: 'summarize_reviews', status: 'stopped' }] }), false, 'AI 서비스 연결이 끊겼습니다.');
    rerender(<AssistantChat />);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByRole('alert').textContent).toBe('AI 서비스 연결이 끊겼습니다.');
    act(() => jest.advanceTimersByTime(400));
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('조회 전 오류에도 응답 생성 중 알림을 남기지 않는다', () => {
    setStream(reply(), true);
    const { rerender } = render(<AssistantChat />);
    expect(screen.getByRole('status').textContent).toBe('응답 생성 중');
    setStream(reply(), false, '연결 오류');
    rerender(<AssistantChat />);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('부분 답변 후 실패하면 응답 완료를 예약하지 않는다', () => {
    setStream(reply({ content: '일부 답변' }), true);
    const { rerender } = render(<AssistantChat />);
    setStream(reply({ content: '일부 답변' }), false, '연결 오류');
    rerender(<AssistantChat />);
    act(() => jest.advanceTimersByTime(400));
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByRole('alert').textContent).toBe('연결 오류');
  });

  it('정상 완료 알림은 포커스 이동 뒤에 전달한다', () => {
    setStream(reply(), true);
    const { rerender } = render(<AssistantChat />);
    setStream(reply({ content: '완성된 답변' }), false);
    rerender(<AssistantChat />);
    expect(screen.getByRole('status').textContent).toBe('응답 생성 중');
    act(() => jest.advanceTimersByTime(400));
    expect(screen.getByRole('status').textContent).toBe('응답 완료. 완성된 답변');
  });

  it('예약된 완료 알림 뒤 오류가 오면 예약을 취소한다', () => {
    setStream(reply(), true);
    const { rerender } = render(<AssistantChat />);
    const completed = reply({ content: '완성된 답변' });
    setStream(completed, false);
    rerender(<AssistantChat />);
    setStream(completed, false, '연결 오류');
    rerender(<AssistantChat />);
    act(() => jest.advanceTimersByTime(400));
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('예약된 완료 알림 뒤 새 요청이 시작되면 이전 답변을 읽지 않는다', () => {
    setStream(reply(), true);
    const { rerender } = render(<AssistantChat />);
    setStream(reply({ content: '이전 답변' }), false);
    rerender(<AssistantChat />);
    setStream(reply({ tools: [{ name: 'summarize_reviews', status: 'running' }] }), true);
    rerender(<AssistantChat />);
    act(() => jest.advanceTimersByTime(400));
    expect(screen.getByRole('status').textContent).toBe('리뷰 조회 중');
  });

  it('예약된 완료 알림 뒤 새 대화로 초기화하면 알림을 비운다', () => {
    setStream(reply(), true);
    const { rerender } = render(<AssistantChat />);
    setStream(reply({ content: '이전 답변' }), false);
    rerender(<AssistantChat />);
    setStream(undefined, false);
    rerender(<AssistantChat />);
    act(() => jest.advanceTimersByTime(400));
    expect(screen.getByRole('status').textContent).toBe('');
  });
});
