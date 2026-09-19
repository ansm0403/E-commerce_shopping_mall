'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'
import { useResendVerificationMutation } from '@/hook/useAuthMutation'

export default function CheckEmailContent() {
  const searchParams = useSearchParams()
  const email = searchParams.get('email')
  // 가입은 됐지만 인증 메일 발송이 실패한 경우(RegisterForm 이 sent=0 을 붙여 보냄)
  const sendFailed = searchParams.get('sent') === '0'
  const resendMutation = useResendVerificationMutation()
  const [resendMessage, setResendMessage] = useState<string | null>(null)

  const handleResend = async () => {
    if (!email) return
    setResendMessage(null)

    try {
      const response = await resendMutation.mutateAsync(email)
      setResendMessage(response.data.message)
    } catch (error) {
      // 서버 메시지(쿨다운 남은 시간, 발송 실패 등)를 그대로 보여준다 — 고정 문구로 덮으면
      // "3분 후 재발송 가능"과 "메일 서버 장애"를 사용자가 구분할 수 없다
      const axiosErr = error as { response?: { data?: { message?: unknown } } }
      const message = axiosErr?.response?.data?.message
      setResendMessage(
        typeof message === 'string' ? message : '재발송에 실패했습니다. 잠시 후 다시 시도해주세요.',
      )
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px]">
      <div className="max-w-[420px] w-full flex flex-col items-center gap-5 p-8 rounded-xl border border-gray-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.15)]">
        <div className="w-16 h-16 flex items-center justify-center rounded-full bg-blue-50 text-3xl">
          &#9993;
        </div>

        <h1 className="text-xl font-bold">이메일을 확인해주세요</h1>

        <p className="text-sm text-gray-500 text-center leading-relaxed">
          {sendFailed ? (
            <>
              회원가입은 완료되었지만 인증 메일 발송에 실패했습니다.
              <br />
              잠시 후 아래 <span className="font-medium text-gray-700">인증 메일 재발송</span>을 눌러주세요.
            </>
          ) : email ? (
            <>
              <span className="font-medium text-gray-700">{email}</span>
              으로 인증 메일을 보냈습니다.
              <br />
              메일의 인증 링크를 클릭하면 가입이 완료됩니다.
            </>
          ) : (
            '회원가입 시 입력한 이메일로 인증 메일을 보냈습니다.'
          )}
        </p>

        <div className="w-full flex flex-col gap-2 mt-2">
          {email && (
            <button
              type="button"
              onClick={handleResend}
              disabled={resendMutation.isPending}
              className="w-full px-3 py-2.5 rounded-[10px] border border-gray-300 text-sm font-medium text-gray-700 bg-white cursor-pointer transition-colors duration-150 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resendMutation.isPending ? '발송 중...' : '인증 메일 재발송'}
            </button>
          )}

          {resendMessage && (
            <p className={`text-xs text-center ${resendMutation.isError ? 'text-red-500' : 'text-green-600'}`}>
              {resendMessage}
            </p>
          )}
        </div>

        <Link href="/login" className="text-sm text-blue-600 hover:underline mt-2">
          로그인 페이지로 이동
        </Link>
      </div>
    </div>
  )
}
