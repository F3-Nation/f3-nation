// Use process.env so that importing here doesn't cause issues like circular dependencies
export const isProduction = process.env.NODE_ENV === "production";
export const isDevelopment = process.env.NODE_ENV === "development";
export const isTest = process.env.NODE_ENV === "test";

export const isProductionNodeEnv = process.env.NODE_ENV === "production";
export const isDevelopmentNodeEnv = process.env.NODE_ENV === "development";
export const isTestNodeEnv = process.env.NODE_ENV === "test";

export const isProd = process.env.NEXT_PUBLIC_CHANNEL === "prod";

export const RERENDER_LOGS = false;

export const COOKIE_NAME = "authjs";
