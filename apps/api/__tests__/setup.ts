Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? "test" });
process.env.SKIP_ENV_VALIDATION = "true";
process.env.API_KEY = process.env.API_KEY ?? "test-api-key";
