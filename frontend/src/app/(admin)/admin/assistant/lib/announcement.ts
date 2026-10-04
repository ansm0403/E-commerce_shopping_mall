import { toolStatusText, type ChatMessage } from './chat-message';

/**
 * 스크린리더 알림 문구 — "상태만 실시간, 본문은 완성 후 1회".
 *
 * 델타마다 live region 을 갱신하면 스크린리더가 "매출, 은, 지난, 주…" 처럼 조각을 읽거나 앞 문장을 끊는다.
 * 그래서 흘러나오는 글자는 알리지 않고, 상태가 바뀔 때만("응답 생성 중" → "○○ 조회 중" → "응답 완료") 알린 뒤
 * 완료 시점에 본문 전체를 한 번 읽게 한다.
 *
 * 순수 함수 — 상태 전이를 단위 테스트로 고정한다.
 */

/**
 * 마크다운 기호를 걷어 낸 "읽을 글자". 스크린리더가 별표·샵·세로줄을 소리 내어 읽지 않게 한다.
 * 표는 칸을 쉼표로 이어 한 줄씩 읽힌다. 화면 렌더링과는 무관하다(알림 전용).
 */
export function toSpeechText(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !/^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$/.test(line)) // 표 구분선(|---|---|)·수평선
    .map((line) =>
      line
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // 이미지 → 대체 텍스트
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 링크 → 글자만
        .replace(/^\s*\|/, '') // 표 행의 양끝 세로줄
        .replace(/\|\s*$/, '')
        .replace(/\s*\|\s*/g, ', ') // 칸 구분
        .replace(/^\s{0,3}#{1,6}\s+/, '') // 제목
        .replace(/^\s*>\s?/, '') // 인용
        .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '') // 체크리스트
        .replace(/^\s*[-*+]\s+/, '') // 목록
        .replace(/[*~`]+/g, '') // 굵게·기울임·취소선·코드
        // 밑줄 강조(_기울임_)는 낱말 가장자리의 것만 — get_sales_summary 같은 이름 속 밑줄은 남긴다
        .replace(/(^|[\s(])_{1,3}(?=\S)/g, '$1')
        .replace(/(?<=\S)_{1,3}(?=$|[\s).,!?])/g, '')
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join(' ');
}

/**
 * 지금 알릴 문구. `null` = 바꾸지 않는다(같은 상태가 이어지는 중 — 다시 읽게 하지 않는다).
 *
 * @param wasStreaming 직전 렌더의 진행 여부
 * @param streaming    지금 진행 여부
 * @param last         마지막 메시지(진행 중이거나 막 끝난 assistant 답변)
 */
export function nextAnnouncement(
  wasStreaming: boolean,
  streaming: boolean,
  last: ChatMessage | undefined,
): string | null {
  if (streaming) {
    const running = last?.tools?.find((t) => t.status === 'running');
    if (running) return toolStatusText(running); // "매출 데이터 조회 중"
    // 도구가 끝나 답변이 흘러나오는 동안에는 문구를 바꾸지 않는다(조각 읽기 방지). 시작 직후에만 알린다.
    return wasStreaming ? null : '응답 생성 중';
  }

  if (!wasStreaming) return null; // 진행한 적이 없다(첫 화면·복원) — 알리지 않는다

  // 방금 끝났다
  if (!last || last.role !== 'assistant') return null;
  if (last.stopped) return '응답을 중지했습니다.';
  if (!last.content) return null; // 오류로 끝남 — 오류 문구는 따로 role="alert" 가 알린다
  return `응답 완료. ${toSpeechText(last.content)}`;
}
