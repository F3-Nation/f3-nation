import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadEnvConfig } from '@/lib/env';
import { SUPABASE_POOL_CONFIG } from './pool-config';
import * as schema from './schema';

// Load environment variables
const { POSTGRES_URL } = loadEnvConfig();

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: POSTGRES_URL,
  ...SUPABASE_POOL_CONFIG,
});

// Create drizzle database instance
export const db = drizzle(pool, { schema });

// Export for use in scripts
export const getPool = () => pool;
