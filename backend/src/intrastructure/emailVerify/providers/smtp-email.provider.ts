import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as Sentry from '@sentry/nestjs';
import { Transporter } from 'nodemailer';
import {
  IEmailProvider,
  EmailOptions,
  EmailSendResult,
} from '../interfaces/email.interface';

@Injectable()
export class SmtpEmailProvider implements IEmailProvider {
  private transporter: Transporter;

  constructor(private readonly configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get('MAIL_HOST'),
      port: this.configService.get('MAIL_PORT'),
      secure: this.configService.get('MAIL_SECURE') === 'true',
      auth: {
        user: this.configService.get('MAIL_USER'),
        pass: this.configService.get('MAIL_PASSWORD'),
      },
    });
  }

  async send(options: EmailOptions): Promise<EmailSendResult> {
    const from =
      options.from ||
      `"${this.configService.get('MAIL_FROM_NAME')}" <${this.configService.get('MAIL_FROM_ADDRESS')}>`;

    try {
      const info = await this.transporter.sendMail({
        from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      console.log('이메일 전송 성공:', info.messageId);
      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      console.error('이메일 전송 실패:', error);
      // 호출부는 실패를 HttpException(503 등)으로 바꿔 응답하는데, SentryGlobalFilter 는
      // HttpException 을 상태코드와 무관하게 "예상된 에러"로 보고 캡처하지 않는다.
      // 원본 SMTP 에러(535 인증 실패 등)가 살아 있는 여기서 직접 보고해야 알림이 온다.
      // (2026-09-19: 네이버 "SMTP 사용"이 90일 미사용으로 꺼져 가입 메일이 조용히 실패)
      Sentry.captureException(error, {
        tags: { area: 'email', provider: 'smtp' },
        extra: { subject: options.subject },
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
