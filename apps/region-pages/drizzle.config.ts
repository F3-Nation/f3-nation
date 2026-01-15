import { defineConfig } from 'drizzle-kit';
import { loadEnvConfig } from '@/lib/env';

const { POSTGRES_URL } = loadEnvConfig();

export default defineConfig({
  schema: './drizzle/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: POSTGRES_URL,
  },
  verbose: true,
  strict: true,
});
