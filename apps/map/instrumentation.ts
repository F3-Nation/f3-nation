export async function register() {
  // https://orpc.dev/docs/best-practices/optimize-ssr
  // Conditionally import if facing runtime compatibility issues
  // if (process.env.NEXT_RUNTIME === "nodejs") {
  await import("~/orpc/client.server");
  // }
}
