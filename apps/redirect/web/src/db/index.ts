import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Cloud SQL via the Cloud Run connector uses a unix-socket form
//   postgres://user:pass@/db?host=/cloudsql/PROJECT:REGION:INSTANCE
// whose empty host is rejected by the WHATWG URL parser, so build the client
// from explicit options in that case. Standard TCP URLs (local Postgres) pass
// straight through.
function makeClient() {
  // Match the empty-host socket form. Capture the `host` query param up to the
  // next `&` (not `$`), so additional params like `&sslmode=disable` in any
  // order don't get swallowed into the socket path.
  const socket =
    /^postgres(?:ql)?:\/\/([^:@/]+):([^@/]+)@\/([^?]+)\?(.+)$/.exec(
      connectionString!,
    );
  if (socket) {
    const [, user, pass, database, query] = socket;
    const host = /(?:^|&)host=([^&]+)/.exec(query ?? "")?.[1];
    if (user && pass && database && host) {
      return postgres({
        host: decodeURIComponent(host),
        database: decodeURIComponent(database),
        username: decodeURIComponent(user),
        password: decodeURIComponent(pass),
        prepare: false,
      });
    }
  }
  return postgres(connectionString!, { prepare: false });
}

const client = makeClient();

export const db = drizzle(client, { schema });
export { schema };
