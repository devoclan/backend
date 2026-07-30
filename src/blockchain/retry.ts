export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: (error: unknown) => boolean;
}

const defaultOptions: Required<RetryOptions> = {
  maxAttempts: 5,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
  isRetryable: () => true,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential-backoff retry wrapper for Soroban RPC calls. Soroban RPC
 * endpoints are a shared public resource this project doesn't control
 * (ROADMAP.md §7 risk), so every call into them goes through this rather
 * than being retried ad hoc per call site.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === opts.maxAttempts;
      if (isLastAttempt || !opts.isRetryable(error)) {
        throw error;
      }
      const delay = Math.min(opts.baseDelayMs * 2 ** (attempt - 1), opts.maxDelayMs);
      await sleep(delay);
    }
  }

  throw lastError;
}

type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
}

/**
 * Minimal circuit breaker: after `failureThreshold` consecutive failures,
 * short-circuits calls for `cooldownMs` instead of hammering a struggling
 * RPC endpoint, then allows one trial call through (half-open) to probe
 * recovery.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed < this.cooldownMs) {
        throw new Error('Circuit breaker open: Soroban RPC calls are temporarily suspended');
      }
      this.state = 'half-open';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
