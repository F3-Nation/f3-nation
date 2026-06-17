// Use process.env so that importing here doesn't cause issues like circular dependencies

export const isProd = process.env.NEXT_PUBLIC_CHANNEL === "prod";

export const COOKIE_NAME = "authjs";
export const RERENDER_LOGS = false;

// Use process.env so that importing here doesn't cause issues like circular dependencies
export const isProductionNodeEnv = process.env.NODE_ENV === "production";
export const isDevelopmentNodeEnv = process.env.NODE_ENV === "development";
export const isTestNodeEnv = process.env.NODE_ENV === "test";

export const isProduction = isProductionNodeEnv;
export const isDevelopment = isDevelopmentNodeEnv;
export const isTest = isTestNodeEnv;
