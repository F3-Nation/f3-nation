import { Pool, PoolClient, PoolConfig } from 'pg';

export type RetryPoolConfig = PoolConfig & {
  /** Max connection attempts before giving up. Default: 3 */
  maxRetries?: number;
  /** Base delay in ms between retries (doubles each attempt). Default: 2000 */
  retryBaseDelayMs?: number;
  /** Max delay cap in ms. Default: 15000 */
  retryMaxDelayMs?: number;
};

const RETRYABLE_PATTERNS = [
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'connection terminated',
  'Connection terminated',
];

function isRetryable(error: unknown): boolean {
  const message = String(error);
  return RETRYABLE_PATTERNS.some((pattern) => message.includes(pattern));
}

function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
}

/**
 * A pg Pool subclass that retries connection acquisition on transient
 * network errors (ETIMEDOUT, ECONNRESET, ECONNREFUSED).
 *
 * Drizzle and raw pool.query() both go through connect() internally,
 * so all queries through this pool get automatic retry behaviour.
 */
export class RetryPool extends Pool {
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;

  constructor(config: RetryPoolConfig) {
    const { maxRetries, retryBaseDelayMs, retryMaxDelayMs, ...poolConfig } =
      config;
    super(poolConfig);
    this.maxRetries = maxRetries ?? 3;
    this.retryBaseDelayMs = retryBaseDelayMs ?? 2_000;
    this.retryMaxDelayMs = retryMaxDelayMs ?? 15_000;

    // Log pool-level errors instead of crashing
    this.on('error', (err) => {
      console.error('[RetryPool] idle client error:', err.message);
    });
  }

  override async connect(): Promise<PoolClient> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await super.connect();
      } catch (error) {
        if (!isRetryable(error) || attempt >= this.maxRetries) {
          throw error;
        }

        const delay = backoffDelay(
          attempt,
          this.retryBaseDelayMs,
          this.retryMaxDelayMs
        );
        console.warn(
          `[RetryPool] connect failed (attempt ${attempt}/${this.maxRetries}): ${String(error)}. Retrying in ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Unreachable — the loop always throws on final attempt
    throw new Error('[RetryPool] connect exhausted retries');
  }

  /**
   * Quick connectivity check — runs SELECT 1 and returns true/false.
   * Useful as a pre-flight check before long-running pipelines.
   */
  async isReachable(): Promise<boolean> {
    try {
      const client = await this.connect();
      try {
        await client.query('SELECT 1');
        return true;
      } finally {
        client.release();
      }
    } catch {
      return false;
    }
  }
}
