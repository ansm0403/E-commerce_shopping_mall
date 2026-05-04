'use client';

import { useAuth } from '../../../../contexts/AuthContext';

export default function DemoModeBanner() {
  const { user } = useAuth();
  if (!user?.isDemo) return null;

  return (
    <div style={{
      background: '#fef3c7',
      borderBottom: '1px solid #fcd34d',
      padding: '10px 20px',
      fontSize: '13px',
      color: '#78350f',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      flexShrink: 0,
    }}>
      <span>
        🎭 <strong>데모 모드</strong> — 포트폴리오 시연용 관리자 계정입니다.
        카테고리 수정/삭제, 주문 상태 변경, 셀러 승인 등 일부 기능은 제한됩니다.
      </span>
      <a
        href="/"
        style={{
          color: '#92400e',
          textDecoration: 'underline',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        체험 종료
      </a>
    </div>
  );
}
