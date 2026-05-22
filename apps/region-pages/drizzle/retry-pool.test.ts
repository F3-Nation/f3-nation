import { RetryPool } from './retry-pool';

// Mock pg.Pool — we test the retry logic, not actual TCP connections
jest.mock('pg', () => {
  const original = jest.requireActual('pg');
  return {
    ...original,
    Pool: class MockPool {
      private connectFn: (() => Promise<unknown>) | undefined;
      on() {
        return this;
      }
      // Overridden by RetryPool, but needed for super.connect()
      async connect() {
        if (this.connectFn) return this.connectFn();
        return { query: jest.fn(), release: jest.fn() };
      }
      _setConnectFn(fn: () => Promise<unknown>) {
        this.connectFn = fn;
      }
    },
  };
});

describe('RetryPool', () => {
  it('should succeed on first attempt when connection works', async () => {
    const pool = new RetryPool({
      connectionString: 'postgresql://test',
      maxRetries: 3,
      retryBaseDelayMs: 10,
    });

    const client = await pool.connect();
    expect(client).toBeDefined();
  });

  it('should retry on ETIMEDOUT and succeed on later attempt', async () => {
    let attempt = 0;
    const pool = new RetryPool({
      connectionString: 'postgresql://test',
      maxRetries: 3,
      retryBaseDelayMs: 10,
    });

    // Monkey-patch the parent connect to simulate failures
    const origConnect = Object.getPrototypeOf(
      Object.getPrototypeOf(pool)
    ).connect;
    const mockClient = { query: jest.fn(), release: jest.fn() };

    jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(pool)), 'connect')
      .mockImplementation(async () => {
        attempt++;
        if (attempt < 3) {
          throw new Error('connect ETIMEDOUT 35.239.19.124:5432');
        }
        return mockClient;
      });

    const client = await pool.connect();
    expect(attempt).toBe(3);
    expect(client).toBe(mockClient);
  });

  it('should throw after exhausting all retries', async () => {
    const pool = new RetryPool({
      connectionString: 'postgresql://test',
      maxRetries: 2,
      retryBaseDelayMs: 10,
    });

    jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(pool)), 'connect')
      .mockRejectedValue(new Error('connect ETIMEDOUT 35.239.19.124:5432'));

    await expect(pool.connect()).rejects.toThrow('ETIMEDOUT');
  });

  it('should not retry on non-transient errors', async () => {
    let attempts = 0;
    const pool = new RetryPool({
      connectionString: 'postgresql://test',
      maxRetries: 3,
      retryBaseDelayMs: 10,
    });

    jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(pool)), 'connect')
      .mockImplementation(async () => {
        attempts++;
        throw new Error('password authentication failed');
      });

    await expect(pool.connect()).rejects.toThrow('password authentication');
    expect(attempts).toBe(1);
  });

  it('should retry on ECONNRESET errors', async () => {
    let attempts = 0;
    const pool = new RetryPool({
      connectionString: 'postgresql://test',
      maxRetries: 3,
      retryBaseDelayMs: 10,
    });

    const mockClient = { query: jest.fn(), release: jest.fn() };
    jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(pool)), 'connect')
      .mockImplementation(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('read ECONNRESET');
        }
        return mockClient;
      });

    const client = await pool.connect();
    expect(attempts).toBe(2);
    expect(client).toBe(mockClient);
  });
});
