/**
 * SSE `data:` 프레임 파서 — 순수 함수(네트워크·상태 없음)라 단위 테스트로 경계 조건을 고정한다.
 *
 * 스트림 청크는 프레임 경계와 무관하게 잘려 온다. 그래서 받은 글자를 버퍼에 쌓고,
 * 빈 줄(`\n\n`)로 **끝난 프레임만** 꺼낸 뒤 나머지(`rest`)는 다음 청크 앞에 다시 붙인다.
 *
 * - `data:` 줄이 없는 프레임(주석·keep-alive)은 건너뛴다.
 * - JSON 이 깨진 프레임은 건너뛰고 다음 프레임을 계속 읽는다(프레임 하나가 스트림 전체를 끊지 않게).
 */
export function parseSseChunk<T>(buffer: string): { events: T[]; rest: string } {
  const events: T[] = [];
  let rest = buffer;

  let sep: number;
  while ((sep = rest.indexOf('\n\n')) !== -1) {
    const frame = rest.slice(0, sep);
    rest = rest.slice(sep + 2);

    const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) continue;

    const json = dataLine.slice(5).trim();
    if (!json) continue;

    try {
      events.push(JSON.parse(json) as T);
    } catch {
      /* 깨진 프레임 — 건너뛴다 */
    }
  }

  return { events, rest };
}
