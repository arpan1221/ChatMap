/**
 * Ollama LLM Client
 * Handles chat completions, streaming, and embeddings with retry logic
 */

import { Config } from '@/src/lib/config';
import { withRetry, RetryableError } from '@/src/lib/retry';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  format?: 'json' | '';
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number; // Max tokens
    stop?: string[];
    seed?: number;
  };
  system?: string;
  template?: string;
  context?: number[];
  raw?: boolean;
}

export interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[]; // Base64 encoded images
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream?: boolean;
  format?: 'json' | '';
  options?: OllamaGenerateRequest['options'];
  template?: string;
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: OllamaChatMessage;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaEmbeddingRequest {
  model: string;
  prompt: string;
  options?: {
    num_ctx?: number;
    num_batch?: number;
  };
}

export interface OllamaEmbeddingResponse {
  embedding: number[];
}

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    format: string;
    family: string;
    families?: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

export interface OllamaListResponse {
  models: OllamaModel[];
}

export class OllamaError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'OllamaError';
  }
}

// ============================================================================
// Ollama Client
// ============================================================================

export class OllamaClient {
  private readonly config = Config.ollama;
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = this.config.endpoint;
  }

  /**
   * Make a request to Ollama API with retry logic
   */
  private async makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST',
    body?: unknown
  ): Promise<T> {
    return withRetry(
      async () => {
        const url = new URL(endpoint, this.baseUrl);

        const requestOptions: RequestInit = {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(this.config.timeout),
        };

        if (body && method === 'POST') {
          requestOptions.body = JSON.stringify(body);
        }

        const response = await fetch(url.toString(), requestOptions);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          
          // Determine if error is retryable
          const isRetryable = response.status >= 500 || response.status === 429;
          
          const error = new OllamaError(
            errorData.error || `Ollama API error: ${response.statusText}`,
            response.status,
            errorData
          );

          if (isRetryable) {
            throw new RetryableError(error.message, error);
          }
          throw error;
        }

        return response.json() as Promise<T>;
      },
      {
        maxRetries: this.config.maxRetries,
        initialDelay: 500,
        onRetry: (error, attempt, delay) => {
          console.warn(
            `[Ollama] Request failed (attempt ${attempt}/${this.config.maxRetries}), retrying in ${delay}ms:`,
            error instanceof Error ? error.message : String(error)
          );
        },
      }
    );
  }

  /**
   * Make a streaming request to Ollama API
   */
  private async makeStreamingRequest<T>(
    endpoint: string,
    body: unknown,
    onChunk: (chunk: T) => void
  ): Promise<void> {
    const url = new URL(endpoint, this.baseUrl);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new OllamaError(
        errorData.error || `Ollama API error: ${response.statusText}`,
        response.status,
        errorData
      );
    }

    if (!response.body) {
      throw new OllamaError('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            try {
              const chunk = JSON.parse(line) as T;
              onChunk(chunk);
            } catch (error) {
              console.error('[Ollama] Failed to parse chunk:', line, error);
            }
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const chunk = JSON.parse(buffer) as T;
          onChunk(chunk);
        } catch (error) {
          console.error('[Ollama] Failed to parse final chunk:', buffer, error);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Generate text completion from a prompt
   * 
   * @example
   * ```typescript
   * const response = await ollamaClient.generate({
   *   model: 'llama3.2:3b',
   *   prompt: 'Explain quantum computing in simple terms',
   *   options: { temperature: 0.7 },
   * });
   * console.log(response.response);
   * ```
   */
  async generate(request: OllamaGenerateRequest): Promise<OllamaGenerateResponse> {
    return this.makeRequest<OllamaGenerateResponse>('/api/generate', 'POST', {
      ...request,
      model: request.model || this.config.model,
      stream: false,
    });
  }

  /**
   * Generate text completion with streaming
   * 
   * @example
   * ```typescript
   * await ollamaClient.generateStream(
   *   {
   *     model: 'llama3.2:3b',
   *     prompt: 'Write a short story',
   *   },
   *   (chunk) => {
   *     if (!chunk.done) {
   *       process.stdout.write(chunk.response);
   *     }
   *   }
   * );
   * ```
   */
  async generateStream(
    request: OllamaGenerateRequest,
    onChunk: (chunk: OllamaGenerateResponse) => void
  ): Promise<void> {
    await this.makeStreamingRequest<OllamaGenerateResponse>(
      '/api/generate',
      {
        ...request,
        model: request.model || this.config.model,
        stream: true,
      },
      onChunk
    );
  }

  /**
   * Chat completion with conversation history
   * 
   * @example
   * ```typescript
   * const response = await ollamaClient.chat({
   *   model: 'llama3.2:3b',
   *   messages: [
   *     { role: 'system', content: 'You are a helpful assistant' },
   *     { role: 'user', content: 'What is the capital of France?' },
   *   ],
   * });
   * console.log(response.message.content);
   * ```
   */
  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
    return this.makeRequest<OllamaChatResponse>('/api/chat', 'POST', {
      ...request,
      model: request.model || this.config.model,
      stream: false,
    });
  }

  /**
   * Chat completion with streaming
   * 
   * @example
   * ```typescript
   * await ollamaClient.chatStream(
   *   {
   *     model: 'llama3.2:3b',
   *     messages: [
   *       { role: 'user', content: 'Tell me a joke' },
   *     ],
   *   },
   *   (chunk) => {
   *     if (!chunk.done) {
   *       process.stdout.write(chunk.message.content);
   *     }
   *   }
   * );
   * ```
   */
  async chatStream(
    request: OllamaChatRequest,
    onChunk: (chunk: OllamaChatResponse) => void
  ): Promise<void> {
    await this.makeStreamingRequest<OllamaChatResponse>(
      '/api/chat',
      {
        ...request,
        model: request.model || this.config.model,
        stream: true,
      },
      onChunk
    );
  }

  /**
   * Generate embeddings for a text
   * 
   * @example
   * ```typescript
   * const response = await ollamaClient.embeddings({
   *   model: 'llama3.2:3b',
   *   prompt: 'The quick brown fox jumps over the lazy dog',
   * });
   * console.log(response.embedding); // Array of numbers
   * ```
   */
  async embeddings(request: OllamaEmbeddingRequest): Promise<OllamaEmbeddingResponse> {
    return this.makeRequest<OllamaEmbeddingResponse>('/api/embeddings', 'POST', {
      ...request,
      model: request.model || this.config.model,
    });
  }

  /**
   * List available models
   * 
   * @example
   * ```typescript
   * const models = await ollamaClient.listModels();
   * console.log(models.models.map(m => m.name));
   * ```
   */
  async listModels(): Promise<OllamaListResponse> {
    return this.makeRequest<OllamaListResponse>('/api/tags', 'GET');
  }

  /**
   * Check if Ollama is running and healthy
   * 
   * @example
   * ```typescript
   * const isHealthy = await ollamaClient.healthCheck();
   * if (!isHealthy) {
   *   console.error('Ollama is not running');
   * }
   * ```
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.listModels();
      return true;
    } catch (error) {
      console.error('[Ollama] Health check failed:', error);
      return false;
    }
  }

  /**
   * Pull a model from Ollama registry
   * Note: This can take a long time for large models
   * 
   * @example
   * ```typescript
   * await ollamaClient.pullModel('llama3.2:3b', (status) => {
   *   console.log(status.status);
   * });
   * ```
   */
  async pullModel(
    modelName: string,
    onProgress?: (status: { status: string; digest?: string; total?: number; completed?: number }) => void
  ): Promise<void> {
    if (onProgress) {
      await this.makeStreamingRequest(
        '/api/pull',
        { name: modelName },
        onProgress
      );
    } else {
      await this.makeRequest('/api/pull', 'POST', { name: modelName });
    }
  }
}

// Export singleton instance
let ollamaClientInstance: OllamaClient | null = null;

export function getOllamaClient(): OllamaClient {
  if (!ollamaClientInstance) {
    ollamaClientInstance = new OllamaClient();
  }
  return ollamaClientInstance;
}

export default OllamaClient;
