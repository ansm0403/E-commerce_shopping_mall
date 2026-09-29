/**
 * 푸시 알림 → 화면 이동 — 웹 체험판 전용(iOS·안드로이드는 usePushRouting.ts).
 *
 * 웹 체험판은 푸시를 받지 않는다(notifications.ts 가 등록을 건너뛴다). 그런데 네이티브 훅이 부르는
 * `getLastNotificationResponse` 는 웹 구현이 없어 **첫 렌더에서 앱 전체가 멈춘다**. 그래서 빈 훅을 둔다.
 * 웹에서 인시던트로 바로 들어가는 길은 알림이 아니라 URL(`/incidents/<id>`) 자체다.
 */
export function usePushRouting(): void {
  // 의도적으로 비어 있다.
}
