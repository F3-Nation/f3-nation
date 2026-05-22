import { defineConfig } from 'drizzle-kit';
import { loadEnvConfig } from '@/lib/env';

const { F3_DATA_WAREHOUSE_URL } = loadEnvConfig();

if (!F3_DATA_WAREHOUSE_URL) {
  throw new Error(
    'F3_DATA_WAREHOUSE_URL is required for warehouse config (set WAREHOUSE_DB_CONNECTION_MODE=direct)'
  );
}

export default defineConfig({
  schema: './drizzle/migrations/warehouse-schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: F3_DATA_WAREHOUSE_URL,
  },
  verbose: true,
  strict: true,
  // This will introspect the existing database and generate schema
  introspect: {
    casing: 'camel',
  },
});
