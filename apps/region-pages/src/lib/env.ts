import * as dotenv from 'dotenv';

export function loadEnvConfig() {
  const env = process.env.NODE_ENV || 'local';
  dotenv.config({ path: `.env.${env}` });

  // During CI builds (no DB secrets) SKIP_ENV_VALIDATION is set so missing
  // connection strings warn instead of throwing; build-time data fetches fall
  // back to empty. The real deploy build provides POSTGRES_URL and renders fully.
  const skipValidation = !!process.env.SKIP_ENV_VALIDATION;

  if (!process.env.POSTGRES_URL) {
    const msg = `POSTGRES_URL is not set in .env.${env}`;
    if (skipValidation) console.warn(`⚠️ ${msg} (SKIP_ENV_VALIDATION)`);
    else throw new Error(msg);
  }

  const warehouseMode = process.env.WAREHOUSE_DB_CONNECTION_MODE ?? 'direct';
  if (warehouseMode === 'direct' && !process.env.F3_DATA_WAREHOUSE_URL) {
    const msg = `F3_DATA_WAREHOUSE_URL is not set in .env.${env}`;
    if (skipValidation) console.warn(`⚠️ ${msg} (SKIP_ENV_VALIDATION)`);
    else throw new Error(msg);
  }

  return {
    POSTGRES_URL: process.env.POSTGRES_URL,
    F3_DATA_WAREHOUSE_URL: process.env.F3_DATA_WAREHOUSE_URL,
    NODE_ENV: env,
  };
}
