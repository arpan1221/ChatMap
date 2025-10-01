/**
 * Retry utility with exponential backoff
 * Handles transient failures with configurable retry logic
 */

import { Config } from './config';

export interface RetryOptions {
  /**
   * Maximum number of retry attempts
   * @default 3
   */
  maxRetries?: number;

  /**
   * Initial delay in milliseconds before first retry
   * @default 1000
   */
  initialDelay?: number;

  /**
   * Maximum delay in milliseconds between retries
   * @default 10000
   */
  maxDelay?: number;

  /**
   * Multiplier for exponential backoff
   * @default 2
   */
  backoffMultiplier?: number;

  /**
   * Optional timeout for each attempt in milliseconds
   */
  timeout?: number;

  /**
   * Function to determine if an error is retryable
   * @default Retries on network errors and 5xx status codes
   */
  shouldRetry?: (error: unknown, attemptNumber: number) => boolean;

  /**
   * Callback invoked before each retry
   */
  onRetry?: (error: unknown, attemptNumber: number, delay: number) => void;

  /**
   * Add jitter to prevent thundering herd
   * @default true
   */
  useJitter?: boolean;
}

export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly attemptNumber?: number
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

export class NonRetryableError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

/**
 * Default retry predicate
 * Retries on network errors, timeouts, and 5xx server errors
 */
function defaultShouldRetry(error: unknown, attemptNumber: number): boolean {
  // Don't retry if we've exceeded max attempts
  if (attemptNumber >= (Config.retry.defaultMaxRetries || 3)) {
    return false;
  }

  // Always retry RetryableError
  if (error instanceof RetryableError) {
    return true;
  }

  // Never retry NonRetryableError
  if (error instanceof NonRetryableError) {
    return false;
  }

  // Retry network errors
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }

  // Retry timeout errors
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }

  // Retry on HTTP 5xx errors
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof error.status === 'number'
  ) {
    return error.status >= 500 && error.status < 600;
  }

  // Retry on 429 (rate limit) with backoff
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    error.status === 429
  ) {
    return true;
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(
  attemptNumber: number,
  initialDelay: number,
  maxDelay: number,
  backoffMultiplier: number,
  useJitter: boolean
): number {
  // Calculate exponential backoff
  const exponentialDelay = initialDelay * Math.pow(backoffMultiplier, attemptNumber - 1);
  
  // Cap at maxDelay
  let delay = Math.min(exponentialDelay, maxDelay);
  
  // Add jitter to prevent thundering herd
  if (useJitter) {
    // Add random jitter of ±25%
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    delay = Math.max(0, delay + jitter);
  }
  
  return Math.floor(delay);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrap a promise with a timeout
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: Error = new Error(`Operation timed out after ${timeoutMs}ms`)
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(timeoutError), timeoutMs)
    ),
  ]);
}

/**
 * Execute a function with retry logic and exponential backoff
 * 
 * @example
 * ```typescript
 * const data = await withRetry(
 *   async () => {
 *     const response = await fetch('https://api.example.com/data');
 *     if (!response.ok) throw new Error('Request failed');
 *     return response.json();
 *   },
 *   {
 *     maxRetries: 3,
 *     initialDelay: 1000,
 *     onRetry: (error, attempt, delay) => {
 *       console.log(`Retry attempt ${attempt} after ${delay}ms:`, error.message);
 *     }
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = Config.retry.defaultMaxRetries,
    initialDelay = Config.retry.defaultRetryDelay,
    maxDelay = Config.retry.defaultMaxRetryDelay,
    backoffMultiplier = Config.retry.defaultBackoffMultiplier,
    timeout,
    shouldRetry = defaultShouldRetry,
    onRetry,
    useJitter = true,
  } = options;

  let lastError: unknown;
  let attemptNumber = 0;

  while (attemptNumber <= maxRetries) {
    try {
      // Execute the function with optional timeout
      const result = timeout
        ? await withTimeout(fn(), timeout)
        : await fn();
      
      return result;
    } catch (error) {
      lastError = error;
      attemptNumber++;

      // Check if we should retry
      if (attemptNumber > maxRetries || !shouldRetry(error, attemptNumber)) {
        throw error;
      }

      // Calculate delay for next attempt
      const delay = calculateDelay(
        attemptNumber,
        initialDelay,
        maxDelay,
        backoffMultiplier,
        useJitter
      );

      // Call onRetry callback if provided
      if (onRetry) {
        try {
          onRetry(error, attemptNumber, delay);
        } catch (callbackError) {
          console.error('[Retry] Error in onRetry callback:', callbackError);
        }
      }

      // Log retry attempt in development
      if (Config.app.isDevelopment && Config.app.logLevel === 'debug') {
        console.log(
          `[Retry] Attempt ${attemptNumber}/${maxRetries} failed, retrying in ${delay}ms:`,
          error instanceof Error ? error.message : String(error)
        );
      }

      // Wait before next attempt
      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Create a retryable version of a function
 * 
 * @example
 * ```typescript
 * const fetchWithRetry = retryable(
 *   async (url: string) => {
 *     const response = await fetch(url);
 *     if (!response.ok) throw new Error('Request failed');
 *     return response.json();
 *   },
 *   { maxRetries: 3 }
 * );
 * 
 * const data = await fetchWithRetry('https://api.example.com/data');
 * ```
 */
export function retryable<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options: RetryOptions = {}
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    return withRetry(() => fn(...args), options);
  };
}

/**
 * Retry decorator for class methods
 * 
 * @example
 * ```typescript
 * class ApiClient {
 *   @Retry({ maxRetries: 3 })
 *   async fetchData(url: string) {
 *     const response = await fetch(url);
 *     return response.json();
 *   }
 * }
 * ```
 */
export function Retry(options: RetryOptions = {}) {
  return function (
    target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      return withRetry(
        () => originalMethod.apply(this, args),
        options
      );
    };

    return descriptor;
  };
}
