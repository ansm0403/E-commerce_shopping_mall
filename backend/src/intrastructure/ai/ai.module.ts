import { Module, DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LLM_CLIENT } from './ai.constants';
import { LlmClient } from './llm-client.interface';
import { GeminiClient } from './providers/gemini.client';

/**
 * AI 인프라 모듈 (intrastructure/ai).
 *
 * LLM_CLIENT 토큰으로 프로바이더 비종속 LlmClient 를 전역 제공한다.
 * LLM_PROVIDER env 로 구현체를 분기 → 추후 Claude 추가 시 case 한 줄만 늘리면 된다.
 * (redis.module 의 forRoot()+useFactory+global 패턴을 따른다)
 */
@Module({})
export class AiModule {
  static forRoot(): DynamicModule {
    return {
      global: true,
      module: AiModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: LLM_CLIENT,
          useFactory: (config: ConfigService): LlmClient => {
            const provider = config.get<string>('LLM_PROVIDER', 'gemini');
            switch (provider) {
              // case 'claude': return new ClaudeClient(config);  // 추후 전환 지점
              case 'gemini':
              default:
                return new GeminiClient(config);
            }
          },
          inject: [ConfigService],
        },
      ],
      exports: [LLM_CLIENT],
    };
  }
}
