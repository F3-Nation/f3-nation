export const WAREHOUSE_POOL_CONFIG = {
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 30_000,
  statement_timeout: 60_000,
};

export const SUPABASE_POOL_CONFIG = {
  max: 10,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 60_000,
};
