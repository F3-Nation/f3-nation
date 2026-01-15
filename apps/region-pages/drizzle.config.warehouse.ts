import { defineConfig } from 'drizzle-kit';
import { loadEnvConfig } from '@/lib/env';

const { F3_DATA_WAREHOUSE_URL } = loadEnvConfig();

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
