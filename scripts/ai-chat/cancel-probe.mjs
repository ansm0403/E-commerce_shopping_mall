#!/usr/bin/env node
/**
 * 명시적 중지 요청 확인 — **연결은 끊지 않고** stream/cancel 만 보내 서버가 멈추는지 본다.
 * (연결 끊김 감지에 기대지 않는다는 증명. 운영 경로는 프록시가 끊김을 전달하지 않았다 — 04-ai-chat-ux §8)
 *
 * 실행: node scripts/ai-chat/cancel-probe.mjs [--api http://localhost:4000/v1] [--question "…"]
 * 기대: 첫 tool 뒤 cancel → 204 → 스트림이 done 없이 끝남 → 저장된 assistant 턴 없음. 서버 로그에 `[abort]`.
 */
const args = { api: 'http://localhost:4000/v1', question: '2026년 6월 매출이랑 주문 상태 분포를 같이 정리해줘' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) args[argv[i].slice(2)] = argv[i + 1];
const API = args.api.replace(/\/$/, '');

const { accessToken } = await (await fetch(`${API}/auth/demo-login`, { method: 'POST' })).json();
const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
const requestId = crypto.randomUUID();

const res = await fetch(`${API}/admin/assistant/stream`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ message: args.question, requestId }),
});
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
let conversationId = null;
let cancelStatus = null;
const seen = [];
const started = Date.now();

for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  let sep;
  while ((sep = buf.indexOf('\n\n')) !== -1) {
    const ev = JSON.parse(buf.slice(0, sep).replace(/^data:\s*/, ''));
    buf = buf.slice(sep + 2);
    seen.push(ev.type === 'tool' ? `tool:${ev.name}` : ev.type);
    if (ev.type === 'meta') conversationId = ev.conversationId;
    if (ev.type === 'tool' && cancelStatus === null) {
      cancelStatus = 'pending';
      // 스트림 연결은 그대로 둔 채 별도 요청으로 중지
      fetch(`${API}/admin/assistant/stream/cancel`, { method: 'POST', headers, body: JSON.stringify({ requestId }) }).then(
        (r) => (cancelStatus = r.status),
      );
    }
  }
}
const elapsed = Date.now() - started;
await new Promise((r) => setTimeout(r, 300));

const saved = await (await fetch(`${API}/admin/assistant/conversations/${conversationId}/messages`, { headers })).json();
const assistantTurns = saved.messages.filter((m) => m.role === 'assistant');
console.log(`이벤트: ${seen.join(' → ')}`);
console.log(`cancel 응답: ${cancelStatus} · 스트림 종료까지 ${elapsed}ms · done 수신: ${seen.includes('done')}`);
console.log(`저장된 턴: ${saved.messages.map((m) => m.role).join(', ')} (assistant ${assistantTurns.length}건)`);
const ok = cancelStatus === 204 && !seen.includes('done') && assistantTurns.length === 0;
console.log(ok ? '결과: 명시적 중지로 서버가 멈췄다' : '결과: 기대와 다름 — 서버 로그 확인');
process.exit(ok ? 0 : 1);
