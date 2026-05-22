import { defineConfig } from 'drizzle-kit';
import { loadEnvConfig } from '@/lib/env';

const { POSTGRES_URL } = loadEnvConfig();

export default defineConfig({
  schema: './drizzle/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // drizzle-kit receives the real POSTGRES_URL at runtime; `?? ''` only
    // satisfies typecheck when SKIP_ENV_VALIDATION leaves it undefined.
    url: POSTGRES_URL ?? '',
  },
  verbose: true,
  strict: true,
});
