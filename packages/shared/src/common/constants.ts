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

const KEY_BRANCHES = ["main", "master", "staging", "stage", "dev", "develop"];

// TODO: Create tests for this function to ensure that a variety of database urls and git commit refs are handled correctly. Use real urls
function getDatabaseUrl(baseUrl: string, gitCommitRef: string): string {
  return baseUrl.replace(
    /\/([^/?]+)(\?.*)?$/,
    (_match: string, dbName: string, queryParams?: string) => {
      const lastUnderscoreIndex = dbName.lastIndexOf("_");
      const branchName = gitCommitRef.replace(/[^a-zA-Z0-9]/g, "_");
      const newDbName =
        lastUnderscoreIndex >= 0
          ? dbName.substring(0, lastUnderscoreIndex + 1) + branchName
          : dbName + "_" + branchName;
      return `/${newDbName.toLowerCase()}${queryParams ?? ""}`;
    },
  );
}

if (!isProductionNodeEnv) {
  const args = process.argv;
  const previewBranchDbInitFlagIndex = args.indexOf("--preview-branch-db-init");
  if (
    previewBranchDbInitFlagIndex !== -1 &&
    args[previewBranchDbInitFlagIndex + 1]
  ) {
    process.env.VERCEL = "1";
    process.env.VERCEL_GIT_COMMIT_REF = args[previewBranchDbInitFlagIndex + 1];
  }
}

export const vercelInfo =
  process.env.VERCEL &&
  process.env.VERCEL_GIT_COMMIT_REF &&
  process.env.DATABASE_URL
    ? {
        gitCommitRef: process.env.VERCEL_GIT_COMMIT_REF,
        gitBranchUrl: process.env.VERCEL_BRANCH_URL,
        isPreviewDeployment: !KEY_BRANCHES.includes(
          process.env.VERCEL_GIT_COMMIT_REF,
        ),
        // This regex logic must match to any github actions or cleanup
        databaseUrl: getDatabaseUrl(
          process.env.DATABASE_URL,
          process.env.VERCEL_GIT_COMMIT_REF,
        ),
        baseUrl:
          process.env.VERCEL_ENV === "production"
            ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
            : process.env.VERCEL_ENV === "preview"
              ? `https://${process.env.VERCEL_URL}`
              : null,
      }
    : null;
