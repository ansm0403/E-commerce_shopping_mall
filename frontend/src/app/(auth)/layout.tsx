import Link from 'next/link';

/** 로그인·회원가입·이메일 인증 — 쇼핑몰 헤더 없이 로고만 둬서 쇼핑몰의 일부로 보이고 홈으로 돌아갈 수 있게 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#fafaf7] px-4 pt-12 pb-16 sm:pt-20">
      <div className="text-center">
        <Link href="/" className="inline-block font-black text-2xl tracking-tighter text-primary-600" aria-label="SHOPMALL 홈으로">
          SHOPMALL<span aria-hidden="true" className="text-[#526747]">.</span>
        </Link>
      </div>
      {children}
    </div>
  );
}
