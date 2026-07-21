/**
 * (임시) Phase 7 관측 경로 스모크 테스트 — chatWithTrace 가 도구 호출을 캡처하는지 확인.
 * 실행(repo 루트 cwd 에서, .env 가 루트에 있으므로):
 *   TS_NODE_PROJECT=scratchpad/tsconfig.smoke.json \
 *     node -r ts-node/register/transpile-only backend/smoke-eval.ts "질문"
 * 확인 후 이 파일은 삭제한다(다음 단계 러너의 뼈대로만 참고).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app/app.module';
import { AssistantService } from './src/admin/assistant/assistant.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const svc = app.get(AssistantService);

  // (C-3) latent 버그 수정 검증 — 디스패처 직접 호출(LLM 왕복 0, 결정적).
  //   private executeTool 을 런타임 캐스팅으로 직접 호출해 {error} 반환/무크래시 확인.
  const exec = (name: string, args: Record<string, unknown>) =>
    (svc as unknown as { executeTool: (c: unknown) => Promise<unknown> }).executeTool(
      { name, args },
    );
  console.log('\n=== C-3 latent 버그 수정 검증 (직접 디스패치) ===');
  const edgeCases: { label: string; name: string; args: Record<string, unknown> }[] = [
    { label: 'audit 불량날짜(2026-13-45)', name: 'query_audit_logs', args: { startDate: '2026-13-45' } },
    { label: 'audit 비-날짜(지난주)', name: 'query_audit_logs', args: { endDate: '지난주' } },
    { label: 'audit 음수 take(-5)', name: 'query_audit_logs', args: { take: -5 } },
    { label: 'product 음수 take(-3)', name: 'get_product_info', args: { take: -3 } },
  ];
  for (const c of edgeCases) {
    try {
      const res = (await exec(c.name, c.args)) as Record<string, unknown>;
      const shape = res && res['error'] ? `error="${res['error']}"`
        : `ok(keys=${Object.keys(res ?? {}).join(',')})`;
      console.log(`  ✅ ${c.label} → 무크래시, ${shape}`);
    } catch (e) {
      console.log(`  ❌ ${c.label} → CRASH: ${(e as Error).message}`);
    }
  }

  // (C-2) 도구 호출 캡처 end-to-end (LLM 왕복 있음).
  const questions = [
    process.argv[2] || '지난달 매출 알려줘',
  ];
  for (const q of questions) {
    console.log('\n========================================');
    console.log('Q:', q);
    const r = await svc.chatWithTrace(q);
    console.log('--- toolCalls (' + r.toolCalls.length + ') ---');
    for (const t of r.toolCalls) {
      console.log('  •', t.name, JSON.stringify(t.args));
    }
    console.log('--- reply ---');
    console.log(r.reply);
    console.log('--- usage ---', JSON.stringify(r.usage));
  }

  await app.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  process.exit(1);
});
