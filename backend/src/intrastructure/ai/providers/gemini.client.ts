import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import type {
  Content,
  Part,
  GenerateContentConfig,
  GenerateContentResponseUsageMetadata,
} from '@google/genai';
import {
  LlmClient,
  LlmMessage,
  LlmStreamEvent,
  LlmSystemPrompt,
  LlmToolCall,
  LlmToolDef,
  LlmUsage,
} from '../llm-client.interface';

/**
 * Gemini functionDeclarations 묶음(중립 LlmToolDef[] → Gemini tools config).
 * SDK 의 Tool[]/ToolListUnion 과 구조 호환 — 사용처에서 SDK 타입으로 캐스팅한다.
 */
type GeminiToolsConfig =
  | { functionDeclarations: unknown[] }[]
  | undefined;

/**
 * Gemini(@google/genai) 기반 LlmClient 구현체.
 *
 * - GEMINI_API_KEY 가 없으면 비활성(no-op): isEnabled()=false, generate() 호출 금지.
 * - 모델 ID는 GEMINI_MODEL env 로 주입(프로바이더/모델 교체 가능하게). 기본값은
 *   free-tier 가용 모델 확인 후 env 로 박는다(코드 기본값은 보수적 fallback).
 * - 프로바이더 고유 포맷(role 'model', systemInstruction, functionDeclarations 등)은
 *   이 클래스 내부에 가둔다. 바깥에는 LlmClient 인터페이스의 중립 타입만 노출.
 *
 * (Phase 6) 프롬프트 캐싱 / usage:
 * - implicit(자동) 캐싱: Gemini 2.5+ 모델은 공통 prefix(systemInstruction+tools)가 충분히 크면
 *   자동으로 캐시 적중(입력 75% 할인). 코드로 "켜는" 것 없음 — 안정 prefix만 유지하면 된다.
 *   그래서 system 을 {static,dynamic} 으로 받아 날짜를 suffix 로 밀어 prefix 를 안정시킨다.
 * - explicit CachedContent: 무료티어에선 paid feature + flash-lite 미지원이라 사실상 불가.
 *   GEMINI_EXPLICIT_CACHE='true' 일 때만 ai.caches.create 를 시도하고, 실패(무료티어/미지원/
 *   최소치 미달)·키 없음이면 catch → no-op 으로 implicit 경로로 진행한다. 추후 빌링/지원모델
 *   전환 시 env 한 줄로 활성(어시스턴트/도구 코드 무변경).
 * - usage: usageMetadata(promptTokenCount/cachedContentTokenCount 등)를 파싱해 {type:'usage'} 로
 *   흘려보낸다. 캐시 적중량(cachedTokens)을 측정해 적중을 입증한다.
 */
@Injectable()
export class GeminiClient implements LlmClient {
  private readonly logger = new Logger(GeminiClient.name);
  private readonly ai: GoogleGenAI | null;
  private readonly model: string;

  /** explicit CachedContent 사용 여부(기본 off). 무료티어에선 켜도 생성 실패→no-op. */
  private readonly explicitCacheEnabled: boolean;
  /** 생성된 캐시 리소스명(cachedContents/...). 미생성/실패면 null → implicit 경로. */
  private cacheName: string | null = null;
  /** 캐시 생성 1회만 시도(실패 시 매 요청 재시도하지 않음). */
  private cacheAttempted = false;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    // 기본값은 무료티어 친화 + 빠른 스트리밍(비-thinking) 모델. 교체는 GEMINI_MODEL env로.
    this.model = this.config.get<string>('GEMINI_MODEL', 'gemini-3.1-flash-lite');
    this.explicitCacheEnabled =
      this.config.get<string>('GEMINI_EXPLICIT_CACHE') === 'true';

    if (!apiKey) {
      this.ai = null;
      this.logger.warn(
        'GEMINI_API_KEY 미설정 — AI 어시스턴트 비활성(no-op). 키를 backend/.env 에 설정하세요.',
      );
      return;
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.logger.log(
      `Gemini 클라이언트 활성 (model=${this.model}, explicitCache=${this.explicitCacheEnabled})`,
    );
  }

  isEnabled(): boolean {
    return this.ai !== null;
  }

  async generate(params: {
    system: LlmSystemPrompt;
    messages: LlmMessage[];
  }): Promise<string> {
    if (!this.ai) {
      // 호출 측이 isEnabled()로 먼저 걸러야 한다. 방어적으로 명시적 실패.
      throw new Error('GeminiClient 비활성: GEMINI_API_KEY 가 설정되지 않았습니다.');
    }

    // 비스트리밍 단발 경로(Phase 1 임시 + 5c 요약). 캐싱/usage 미적용(string 반환 유지).
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: this.toContents(params.messages),
      config: { systemInstruction: this.composeSystem(params.system) },
    });

    return response.text ?? '';
  }

  async *generateStream(params: {
    system: LlmSystemPrompt;
    messages: LlmMessage[];
  }): AsyncIterable<LlmStreamEvent> {
    if (!this.ai) {
      throw new Error('GeminiClient 비활성: GEMINI_API_KEY 가 설정되지 않았습니다.');
    }

    const cacheName = await this.ensureCachePrefix(params.system, undefined);
    const config = this.buildConfig(params.system, undefined, cacheName);
    const contents = this.toContentsWithDynamic(params.messages, params.system, cacheName);

    const stream = await this.ai.models.generateContentStream({
      model: this.model,
      contents,
      config,
    });

    let lastUsage: GenerateContentResponseUsageMetadata | undefined;
    for await (const chunk of stream) {
      const delta = chunk.text;
      if (delta) yield { type: 'text', delta };
      if (chunk.usageMetadata) lastUsage = chunk.usageMetadata;
    }
    const usage = this.toUsage(lastUsage);
    if (usage) yield { type: 'usage', usage };
    yield { type: 'done' };
  }

  async *generateWithTools(params: {
    system: LlmSystemPrompt;
    messages: LlmMessage[];
    tools: LlmToolDef[];
    executeTool: (call: LlmToolCall) => Promise<unknown>;
  }): AsyncIterable<LlmStreamEvent> {
    if (!this.ai) {
      throw new Error('GeminiClient 비활성: GEMINI_API_KEY 가 설정되지 않았습니다.');
    }

    // 중립 LlmToolDef[] → Gemini functionDeclarations. parametersJsonSchema로 표준 스키마 그대로 전달.
    const toolsCfg: GeminiToolsConfig = [
      {
        functionDeclarations: params.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parametersJsonSchema: t.parameters,
        })),
      },
    ];

    // 캐시는 1회만 시도. 성공 시 config 에 cachedContent 만 두고 system/tools 는 재전송하지 않는다.
    const cacheName = await this.ensureCachePrefix(params.system, toolsCfg);
    const config = this.buildConfig(params.system, toolsCfg, cacheName);
    const contents: Content[] = this.toContentsWithDynamic(
      params.messages,
      params.system,
      cacheName,
    );

    // 라운드별 usage 를 합산(여러 generateContentStream 호출 → 한 질문의 총 토큰).
    const agg: LlmUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      thoughtsTokens: 0,
      totalTokens: 0,
    };

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
      let lastUsage: GenerateContentResponseUsageMetadata | undefined;
      for await (const chunk of stream) {
        if (chunk.usageMetadata) lastUsage = chunk.usageMetadata;
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

      // 라운드별 usage 를 합산 + 적중 관측용 debug 로그(round≥2 면 cachedTokens>0 기대).
      this.accumulateUsage(agg, lastUsage, round);

      // 도구 요청이 없으면 이번 라운드 텍스트가 최종 답변 → usage 흘리고 종료.
      if (calls.length === 0) {
        yield { type: 'usage', usage: agg };
        yield { type: 'done' };
        return;
      }

      // 1) 모델의 tool-call 턴을 "원본 parts 그대로" 대화에 반영.
      //    ⚠ Gemini 3.x는 functionCall에 thought_signature가 붙어오며, 재전송 시 이를 보존해야 한다.
      //    직접 {functionCall:{name,args}}로 재구성하면 signature가 빠져 400 INVALID_ARGUMENT가 난다.
      //    (explicit 캐시와 직교 — 캐시는 system+tools prefix, 서명은 contents 의 functionCall part.)
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

    // 안전장치: 루프 상한 도달 시에도 usage·스트림을 정상 종료.
    yield { type: 'usage', usage: agg };
    yield { type: 'done' };
  }

  /**
   * (Phase 6) explicit CachedContent 생성 — 스캐폴드(기본 off, no-op 폴백).
   * - GEMINI_EXPLICIT_CACHE!=='true' 또는 비활성이면 즉시 null(implicit 경로).
   * - 1회만 시도(cacheAttempted). 캐시는 static system + tools 를 담는다(동적 날짜 제외).
   * - 실패(무료티어 paid 제한/모델 미지원/최소 토큰 미달 등)는 warn 로그 후 null → implicit 진행.
   */
  private async ensureCachePrefix(
    system: LlmSystemPrompt,
    toolsCfg: GeminiToolsConfig,
  ): Promise<string | null> {
    if (!this.explicitCacheEnabled || !this.ai) return null;
    if (this.cacheAttempted) return this.cacheName;
    this.cacheAttempted = true;
    try {
      const cache = await this.ai.caches.create({
        model: this.model,
        config: {
          displayName: 'assistant-prefix',
          systemInstruction: system.static,
          // caches.create 의 tools 는 Tool[](ToolListUnion 보다 좁음) — never 로 캐스팅.
          ...(toolsCfg ? { tools: toolsCfg as never } : {}),
          ttl: '3600s',
        },
      });
      this.cacheName = cache.name ?? null;
      this.logger.log(
        `explicit 캐시 생성 성공: ${this.cacheName} (totalTokens=${cache.usageMetadata?.totalTokenCount})`,
      );
    } catch (e) {
      this.cacheName = null;
      this.logger.warn(
        `explicit 캐시 생성 실패 → implicit 캐싱으로 진행(무료티어/미지원/최소치 미달 가능): ${
          (e as Error).message
        }`,
      );
    }
    return this.cacheName;
  }

  /**
   * 호출 config 구성.
   * - 캐시 활성: cachedContent 만 둔다(캐시에 system+tools 포함 → 재전송 금지=중복 토큰 방지).
   * - 캐시 비활성: systemInstruction(static+dynamic)+tools 를 평소대로 전송(implicit 적중은 자동).
   */
  private buildConfig(
    system: LlmSystemPrompt,
    toolsCfg: GeminiToolsConfig,
    cacheName: string | null,
  ): GenerateContentConfig {
    if (cacheName) {
      return { cachedContent: cacheName };
    }
    return {
      systemInstruction: this.composeSystem(system),
      ...(toolsCfg
        ? { tools: toolsCfg as unknown as GenerateContentConfig['tools'] }
        : {}),
    };
  }

  /** {static,dynamic} → 단일 systemInstruction 문자열(날짜는 suffix). */
  private composeSystem(system: LlmSystemPrompt): string {
    return system.dynamic
      ? `${system.static}\n${system.dynamic}`
      : system.static;
  }

  /**
   * contents 구성. 캐시 활성 시 동적 날짜(systemInstruction 에 못 싣음)를 선두 user 턴으로 주입.
   * 캐시 비활성이면 날짜는 composeSystem 으로 systemInstruction 에 들어가므로 여기선 그대로.
   */
  private toContentsWithDynamic(
    messages: LlmMessage[],
    system: LlmSystemPrompt,
    cacheName: string | null,
  ): Content[] {
    const base = this.toContents(messages);
    if (cacheName && system.dynamic) {
      return [{ role: 'user', parts: [{ text: system.dynamic }] }, ...base];
    }
    return base;
  }

  /** usageMetadata → 중립 LlmUsage. 값이 없으면 null. */
  private toUsage(
    m: GenerateContentResponseUsageMetadata | undefined,
  ): LlmUsage | null {
    if (!m) return null;
    return {
      inputTokens: m.promptTokenCount ?? 0,
      outputTokens: m.candidatesTokenCount ?? 0,
      cachedTokens: m.cachedContentTokenCount ?? 0,
      thoughtsTokens: m.thoughtsTokenCount,
      totalTokens: m.totalTokenCount,
    };
  }

  /** 라운드 usage 를 합산 + 적중 관측용 debug 로그. */
  private accumulateUsage(
    agg: LlmUsage,
    m: GenerateContentResponseUsageMetadata | undefined,
    round: number,
  ): void {
    const u = this.toUsage(m);
    if (!u) return;
    agg.inputTokens += u.inputTokens;
    agg.outputTokens += u.outputTokens;
    agg.cachedTokens += u.cachedTokens;
    agg.thoughtsTokens = (agg.thoughtsTokens ?? 0) + (u.thoughtsTokens ?? 0);
    agg.totalTokens = (agg.totalTokens ?? 0) + (u.totalTokens ?? 0);
    this.logger.debug(
      `usage round=${round} input=${u.inputTokens} cached=${u.cachedTokens} output=${u.outputTokens}`,
    );
  }

  /** 중립 LlmMessage[] → Gemini contents. assistant 는 Gemini 에서 'model' 역할. */
  private toContents(messages: LlmMessage[]): Content[] {
    return messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
  }
}
