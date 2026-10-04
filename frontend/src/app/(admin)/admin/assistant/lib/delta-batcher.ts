/**
 * 텍스트 델타를 모았다가 화면 프레임당 한 번만 반영한다.
 *
 * 왜: 델타 1개 = setState 1회 = 마지막 말풍선의 마크다운 재파싱 1회다. 델타는 초당 수십 개가 올 수 있지만
 * 화면은 초당 60번만 그려지므로, 프레임 사이에 온 델타는 합쳐서 한 번에 넣어도 사람 눈에는 같다.
 *
 * - push  : 버퍼에 쌓고, 예약된 프레임이 없으면 하나 예약한다.
 * - flush : 버퍼를 **즉시** 반영한다. done·도구 이벤트·오류·중지 직전에 부른다 —
 *           비우지 않고 끝내면 마지막 몇 글자가 화면에서 빠진다(중지 시 "본 것 = 저장된 것"이 깨진다).
 * - cancel: 예약만 취소한다(언마운트). 버퍼는 버린다.
 *
 * schedule/cancelSchedule 을 주입받는 이유는 테스트에서 프레임을 손으로 넘기기 위해서다(기본은 requestAnimationFrame).
 */
export interface DeltaBatcher {
  push(delta: string): void;
  flush(): void;
  cancel(): void;
}

export function createDeltaBatcher(
  apply: (text: string) => void,
  schedule: (run: () => void) => number = (run) => requestAnimationFrame(run),
  cancelSchedule: (handle: number) => void = (handle) => cancelAnimationFrame(handle),
): DeltaBatcher {
  let buffer = '';
  let handle: number | null = null;

  const flush = () => {
    if (handle !== null) {
      cancelSchedule(handle);
      handle = null;
    }
    if (!buffer) return;
    const text = buffer;
    buffer = '';
    apply(text);
  };

  return {
    push(delta) {
      buffer += delta;
      if (handle === null) {
        handle = schedule(() => {
          handle = null;
          flush();
        });
      }
    },
    flush,
    cancel() {
      if (handle !== null) cancelSchedule(handle);
      handle = null;
      buffer = '';
    },
  };
}
