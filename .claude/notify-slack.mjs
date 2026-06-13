// Claude Code 훅 → Slack 알림 스크립트
//
// 웹훅 URL은 비밀값이므로 이 파일에 직접 적지 않는다.
// 우선순위: ① 환경변수 SLACK_WEBHOOK_CLAUDE_HOOKS  ② .claude/.slack-webhook 파일(gitignore됨)
//
// Claude Code가 훅 이벤트 JSON을 stdin으로 넘겨주면, 이벤트 종류에 맞는
// 메시지를 만들어 Slack Incoming Webhook으로 POST한다.
// 웹훅이 설정 안 됐으면 조용히 종료해 Claude 작업 흐름을 방해하지 않는다.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

function getWebhookUrl() {
  const fromEnv = process.env.SLACK_WEBHOOK_CLAUDE_HOOKS;
  if (fromEnv && fromEnv.trim().startsWith("https://")) return fromEnv.trim();
  try {
    const lines = readFileSync(join(here, ".slack-webhook"), "utf8").split(/\r?\n/);
    // 주석(#)·빈 줄·플레이스홀더는 건너뛰고, 첫 https:// 줄만 사용
    const url = lines.map((l) => l.trim()).find((l) => l.startsWith("https://"));
    if (url) return url;
  } catch {
    // 파일 없음 → 미설정으로 간주
  }
  return "";
}

async function readStdin() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function buildText(event) {
  const name = event.hook_event_name || "Unknown";
  const cwd = event.cwd || process.cwd();
  const project = cwd.split(/[\\/]/).filter(Boolean).pop() || "project";

  if (name === "Stop") {
    return `✅ *Claude 작업 완료* — \`${project}\``;
  }
  if (name === "Notification") {
    const msg = event.message ? `\n> ${event.message}` : "";
    return `🔔 *Claude가 입력을 기다립니다* — \`${project}\`${msg}`;
  }
  return `ℹ️ Claude 훅(${name}) — \`${project}\``;
}

async function main() {
  const webhook = getWebhookUrl();
  if (!webhook) process.exit(0); // 미설정 → 조용히 종료

  const event = await readStdin();
  const text = buildText(event);

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    // 알림 실패가 Claude 작업을 막지 않도록 무시
  }
  process.exit(0);
}

main();
