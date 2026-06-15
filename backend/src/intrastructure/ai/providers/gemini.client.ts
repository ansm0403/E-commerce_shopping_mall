import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import type { Content, Part } from '@google/genai';
import {
  LlmClient,
  LlmMessage,
  LlmStreamEvent,
  LlmToolCall,
  LlmToolDef,
} from '../llm-client.interface';

/**
 * Gemini(@google/genai) 기반 LlmClient 구현체.
 *
 * - GEMINI_API_KEY 가 없으면 비활성(no-op): isEnabled()=false, generate() 호출 금지.
 * - 모델 ID는 GEMINI_MODEL env 로 주입(프로바이더/모델 교체 가능하게). 기본값은
 *   free-tier 가용 모델 확인 후 env 로 박는다(코드 기본값은 보수적 fallback).
 * - 프로바이더 고유 포맷(role 'model', systemInstruction, functionDeclarations 등)은
 *   이 클래스 내부에 가둔다. 바깥에는 LlmClient 인터페이스의 중립 타입만 노출.
 */
@Injectable()
export class GeminiClient implements LlmClient {
  private readonly logger = new Logger(GeminiClient.name);
  private readonly ai: GoogleGenAI | null;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    // 기본값은 무료티어 친화 + 빠른 스트리밍(비-thinking) 모델. 교체는 GEMINI_MODEL env로.
    this.model = this.config.get<string>('GEMINI_MODEL', 'gemini-3.1-flash-lite');

    if (!apiKey) {
      this.ai = null;
      this.logger.warn(
        'GEMINI_API_KEY 미설정 — AI 어시스턴트 비활성(no-op). 키를 backend/.env 에 설정하세요.',
      );
      return;
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.logger.log(`Gemini 클라이언트 활성 (model=${this.model})`);
  }

  isEnabled(): boolean {
    return this.ai !== null;
  }

  async generate(params: {
    system: string;
    messages: LlmMessage[];
  }): Promise<string> {
    if (!this.ai) {
      // 호출 측이 isEnabled()로 먼저 걸러야 한다. 방어적으로 명시적 실패.
      throw new Error('GeminiClient 비활성: GEMINI_API_KEY 가 설정되지 않았습니다.');
    }

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: this.toContents(params.messages),
      config: { systemInstruction: params.system },
    });

    return response.text ?? '';
  }

  async *generateStream(params: {
    system: string;
    messages: LlmMessage[];
  }): AsyncIterable<LlmStreamEvent> {
    if (!this.ai) {
      throw new Error('GeminiClient 비활성: GEMINI_API_KEY 가 설정되지 않았습니다.');
    }

    const stream = await this.ai.models.generateContentStream({
      model: this.model,
      contents: this.toContents(params.messages),
      config: { systemInstruction: params.system },
    });

    for await (const chunk of stream) {
      const delta = chunk.text;
      if (delta) yield { type: 'text', delta };
    }
    yield { type: 'done' };
  }

  async *generateWithTools(params: {
    system: string;
    messages: LlmMessage[];
    tools: LlmToolDef[];
    executeTool: (call: LlmToolCall) => Promise<unknown>;
  }): AsyncIterable<LlmStreamEvent> {
    if (!this.ai) {
      throw new Error('GeminiClient 비활성: GEMINI_API_KEY 가 설정되지 않았습니다.');
    }

    // 중립 LlmToolDef[] → Gemini functionDeclarations. parametersJsonSchema로 표준 스키마 그대로 전달.
    const config = {
      systemInstruction: params.system,
      tools: [
        {
          functionDeclarations: params.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parametersJsonSchema: t.parameters,
          })),
        },
      ],
    };

    const contents: Content[] = this.toContents(params.messages);

    // 도구 호출 루프: 모델이 도구를 더 요청하지 않을 때까지(최대 MAX_ROUNDS) 왕복.
    const MAX_ROUNDS = 5;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const stream = await this.ai.models.generateContentStream({
        model: this.model,
        contents,
        config,
      });

      const calls: LlmToolCall[] = [];
      const modelParts: Part[] = []; // 모델이 보낸 원본 parts(thoughtSignature 포함)를 누적
      for await (const chunk of stream) {
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          modelParts.push(part);
          if (part.text) yield { type: 'text', delta: part.text };
          if (part.functionCall) {
            calls.push({
              id: part.functionCall.id,
              name: part.functionCall.name ?? '',
              args: (part.functionCall.args ?? {}) as Record<string, unknown>,
            });
          }
        }
      }

      // 도구 요청이 없으면 이번 라운드 텍스트가 최종 답변 → 종료.
      if (calls.length === 0) {
        yield { type: 'done' };
        return;
      }

      // 1) 모델의 tool-call 턴을 "원본 parts 그대로" 대화에 반영.
      //    ⚠ Gemini 3.x는 functionCall에 thought_signature가 붙어오며, 재전송 시 이를 보존해야 한다.
      //    직접 {functionCall:{name,args}}로 재구성하면 signature가 빠져 400 INVALID_ARGUMENT가 난다.
      contents.push({ role: 'model', parts: modelParts });

      // 2) 각 도구 실행 → functionResponse 를 대화에 추가 (다음 라운드에서 모델이 이걸 읽고 답함)
      for (const call of calls) {
        yield { type: 'tool_call', call };
        let result: unknown;
        try {
          result = await params.executeTool(call);
        } catch (e) {
          result = { error: (e as Error).message };
        }
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: call.name,
                ...(call.id ? { id: call.id } : {}),
                response:
                  result && typeof result === 'object'
                    ? (result as Record<string, unknown>)
                    : { result },
              },
            },
          ],
        });
      }
    }

    // 안전장치: 루프 상한 도달 시에도 스트림을 정상 종료.
    yield { type: 'done' };
  }

  /** 중립 LlmMessage[] → Gemini contents. assistant 는 Gemini 에서 'model' 역할. */
  private toContents(messages: LlmMessage[]): Content[] {
    return messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
  }
}
