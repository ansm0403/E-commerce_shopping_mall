export interface EmbeddingUsage {
  requests: number;
  inputCodePoints: number;
  inputBytes: number;
  inputTokens: number | null;
}

export interface EmbeddingResult {
  vectors: number[][];
  usage: EmbeddingUsage;
}

/** Separate from answer generation; accepts one independently embedded input per item. */
export interface EmbeddingClient {
  readonly model: string;
  readonly dimensions: number;
  isEnabled(): boolean;
  embed(inputs: readonly string[], signal?: AbortSignal, beforeRequest?: () => Promise<void>): Promise<EmbeddingResult>;
}
