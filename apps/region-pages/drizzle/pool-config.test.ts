import { WAREHOUSE_POOL_CONFIG, SUPABASE_POOL_CONFIG } from './pool-config';

describe('Pool Configuration', () => {
  describe('warehouse pool', () => {
    it('should have a conservative max connection limit', () => {
      expect(WAREHOUSE_POOL_CONFIG.max).toBeLessThanOrEqual(3);
    });
    it('should have explicit connection timeout', () => {
      expect(WAREHOUSE_POOL_CONFIG.connectionTimeoutMillis).toBeDefined();
      expect(WAREHOUSE_POOL_CONFIG.connectionTimeoutMillis).toBeLessThanOrEqual(
        30_000
      );
    });
    it('should have explicit idle timeout', () => {
      expect(WAREHOUSE_POOL_CONFIG.idleTimeoutMillis).toBeDefined();
    });
    it('should have statement timeout', () => {
      expect(WAREHOUSE_POOL_CONFIG.statement_timeout).toBeDefined();
    });
  });

  describe('supabase pool', () => {
    it('should allow more connections than warehouse', () => {
      expect(SUPABASE_POOL_CONFIG.max).toBeGreaterThan(
        WAREHOUSE_POOL_CONFIG.max
      );
    });
    it('should have explicit connection timeout', () => {
      expect(SUPABASE_POOL_CONFIG.connectionTimeoutMillis).toBeDefined();
    });
    it('should have longer statement timeout for upserts', () => {
      expect(SUPABASE_POOL_CONFIG.statement_timeout).toBeGreaterThanOrEqual(
        WAREHOUSE_POOL_CONFIG.statement_timeout!
      );
    });
  });
});
