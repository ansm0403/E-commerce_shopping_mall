'use client';

// [임시] Sentry 동작 테스트/진단용 페이지 — 테스트 후 이 폴더째 삭제할 것.
import * as Sentry from '@sentry/nextjs';
import { useEffect, useState } from 'react';

export default function SentryTestPage() {
  const [clientReady, setClientReady] = useState<boolean | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    // Sentry 클라이언트가 초기화됐는지(=DSN이 잘 박혔는지) 확인
    setClientReady(!!Sentry.getClient());
  }, []);

  return (
    <main style={{ padding: 40, fontFamily: 'sans-serif' }}>
      <h1>Sentry 프론트 진단</h1>

      <p>
        SDK 초기화 상태:{' '}
        <b style={{ color: clientReady ? 'green' : 'red' }}>
          {clientReady === null ? '확인 중…' : clientReady ? '초기화됨 ✅' : '초기화 안 됨 ❌ (DSN 미반영 → dev 재시작 필요)'}
        </b>
      </p>

      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <button
          type="button"
          style={{ padding: '12px 20px', fontSize: 16, cursor: 'pointer' }}
          onClick={async () => {
            setStatus('전송 중…');
            // 매번 유니크 fingerprint로 "새 이슈"를 강제 생성 → 'A new issue is
            // created' 알림 룰이 발동하는지 검증한다.
            const id = `fe-${Date.now()}`;
            const eventId = Sentry.captureException(
              new Error(`Sentry 프론트 테스트 — ${id}`),
              { fingerprint: [id] }
            );
            // 실제 네트워크 전송 완료까지 대기(최대 3초)
            const ok = await Sentry.flush(3000);
            setStatus(
              `captureException 호출됨. id=${id} / eventId=${eventId} / flush 성공=${ok}`
            );
          }}
        >
          ① 새 이슈 강제 전송 (captureException + 유니크 fingerprint)
        </button>

        <button
          type="button"
          style={{ padding: '12px 20px', fontSize: 16, cursor: 'pointer' }}
          onClick={() => {
            throw new Error('Sentry 프론트 테스트 — throw');
          }}
        >
          ② 에러 던지기 (throw)
        </button>
      </div>

      {status && <p style={{ marginTop: 16 }}>{status}</p>}

      <p style={{ marginTop: 24, color: '#666', fontSize: 14 }}>
        ※ 브라우저 개발자도구 → Network 탭에서 <code>ingest.sentry.io</code> 또는{' '}
        <code>/envelope</code> 요청이 가는지 확인하세요. 요청이 막혀 있으면 광고차단기가 원인입니다.
      </p>
    </main>
  );
}
