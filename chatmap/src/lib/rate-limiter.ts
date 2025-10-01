/**
 * Rate limiter utility
 * Ensures API calls comply with rate limits and prevents abuse
 */

import { Config } from './config';

export interface RateLimiterOptions {
  /**
   * Minimum time in milliseconds between requests
   */
  intervalMs: number;

  /**
   * Maximum number of requests in a time window
   * @default Infinity (no burst limit)
   */
  maxRequests?: number;

  /**
   * Time window in milliseconds for maxRequests
   * @default 60000 (1 minute)
   */
  windowMs?: number;

  /**
   * Callback invoked when a request is delayed
   */
  onThrottle?: (waitTime: number) => void;
}

interface RequestRecord {
  timestamp: number;
}

/**
 * Rate limiter using token bucket algorithm
 */
export class RateLimiter {
  private lastRequestTime = 0;
  private requestQueue: Promise<void> = Promise.resolve();
  private requestHistory: RequestRecord[] = [];

  constructor(private options: RateLimiterOptions) {}

  /**
   * Execute a function with rate limiting
   * Automatically throttles requests to respect rate limits
   * 
   * @example
   * ```typescript
   * const limiter = new RateLimiter({ intervalMs: 1000 });
   * 
   * // Will be throttled to 1 request per second
   * for (let i = 0; i < 10; i++) {
   *   await limiter.execute(async () => {
   *     return fetch('https://api.example.com/data');
   *   });
   * }
   * ```
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Chain requests to ensure sequential execution
    const executePromise = this.requestQueue.then(async () => {
      await this.waitForRateLimit();
      return fn();
    });

    // Update queue
    this.requestQueue = executePromise.then(
      () => {},
      () => {}
    );

    return executePromise;
  }

  /**
   * Wait if necessary to respect rate limits
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();

    // Check interval-based rate limit
    const timeSinceLastRequest = now - this.lastRequestTime;
    const intervalWait = Math.max(0, this.options.intervalMs - timeSinceLastRequest);

    // Check burst rate limit
    let burstWait = 0;
    if (this.options.maxRequests && this.options.windowMs) {
      const windowStart = now - this.options.windowMs;
      
      // Remove old requests outside window
      this.requestHistory = this.requestHistory.filter(
        record => record.timestamp > windowStart
      );

      // Check if we've exceeded burst limit
      if (this.requestHistory.length >= this.options.maxRequests) {
        const oldestRequest = this.requestHistory[0];
        burstWait = Math.max(0, oldestRequest.timestamp + this.options.windowMs - now);
      }
    }

    // Use the longer wait time
    const waitTime = Math.max(intervalWait, burstWait);

    if (waitTime > 0) {
      // Log throttling in development
      if (Config.app.isDevelopment && Config.app.logLevel === 'debug') {
        console.log(`[RateLimiter] Throttling request for ${waitTime}ms`);
      }

      // Call onThrottle callback if provided
      if (this.options.onThrottle) {
        try {
          this.options.onThrottle(waitTime);
        } catch (error) {
          console.error('[RateLimiter] Error in onThrottle callback:', error);
        }
      }

      await this.sleep(waitTime);
    }

    // Update tracking
    this.lastRequestTime = Date.now();
    this.requestHistory.push({ timestamp: this.lastRequestTime });
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Reset the rate limiter state
   */
  reset(): void {
    this.lastRequestTime = 0;
    this.requestHistory = [];
  }

  /**
   * Get current rate limiter statistics
   */
  getStats() {
    const now = Date.now();
    const windowStart = now - (this.options.windowMs || 60000);
    const recentRequests = this.requestHistory.filter(
      record => record.timestamp > windowStart
    );

    return {
      recentRequestCount: recentRequests.length,
      oldestRecentRequest: recentRequests[0]?.timestamp,
      lastRequestTime: this.lastRequestTime,
      timeSinceLastRequest: now - this.lastRequestTime,
    };
  }
}

/**
 * Create a rate-limited version of a function
 * 
 * @example
 * ```typescript
 * const rateLimitedFetch = rateLimited(
 *   async (url: string) => {
 *     const response = await fetch(url);
 *     return response.json();
 *   },
 *   { intervalMs: 1000 }
 * );
 * 
 * // Automatically throttled to 1 request per second
 * const data1 = await rateLimitedFetch('https://api.example.com/data1');
 * const data2 = await rateLimitedFetch('https://api.example.com/data2');
 * ```
 */
export function rateLimited<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options: RateLimiterOptions
): (...args: TArgs) => Promise<TReturn> {
  const limiter = new RateLimiter(options);

  return async (...args: TArgs): Promise<TReturn> => {
    return limiter.execute(() => fn(...args));
  };
}

/**
 * Global rate limiter registry
 * Allows sharing rate limiters across the application
 */
class RateLimiterRegistry {
  private limiters = new Map<string, RateLimiter>();

  /**
   * Get or create a rate limiter for a specific key
   */
  get(key: string, options: RateLimiterOptions): RateLimiter {
    if (!this.limiters.has(key)) {
      this.limiters.set(key, new RateLimiter(options));
    }
    return this.limiters.get(key)!;
  }

  /**
   * Execute a function using a named rate limiter
   */
  async execute<T>(
    key: string,
    options: RateLimiterOptions,
    fn: () => Promise<T>
  ): Promise<T> {
    const limiter = this.get(key, options);
    return limiter.execute(fn);
  }

  /**
   * Reset a specific rate limiter
   */
  reset(key: string): void {
    const limiter = this.limiters.get(key);
    if (limiter) {
      limiter.reset();
    }
  }

  /**
   * Reset all rate limiters
   */
  resetAll(): void {
    this.limiters.forEach(limiter => limiter.reset());
  }

  /**
   * Get statistics for all rate limiters
   */
  getAllStats(): Record<string, ReturnType<RateLimiter['getStats']>> {
    const stats: Record<string, ReturnType<RateLimiter['getStats']>> = {};
    this.limiters.forEach((limiter, key) => {
      stats[key] = limiter.getStats();
    });
    return stats;
  }
}

// Export singleton instance
export const rateLimiterRegistry = new RateLimiterRegistry();
