// Names and ports of the local Docker stack. The defaults match
// docker-compose.yml and the apps' dev scripts; `pnpm local:setup --slot N`
// writes per-checkout overrides to packages/db/.env.

export const LOCAL_PG_CONTAINER = `${process.env.F3_CONTAINER_PREFIX ?? "f3"}-postgres`;

export function localAppOrigin(
  portVar: "F3_ADMIN_PORT" | "F3_ME_PORT",
  defaultPort: number,
): string {
  return `http://localhost:${process.env[portVar] ?? defaultPort}`;
}
