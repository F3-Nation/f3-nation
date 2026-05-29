import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

// Cloud SQL via the Cloud Run connector uses a unix-socket form
//   postgres://user:pass@/db?host=/cloudsql/PROJECT:REGION:INSTANCE
// whose empty host is rejected by the WHATWG URL parser, so build the client
// from explicit options in that case. Standard TCP URLs (local Postgres) pass
// straight through.
function makeClient(connectionString: string) {
  // Match the empty-host socket form. Capture the `host` query param up to the
  // next `&` (not `$`), so additional params like `&sslmode=disable` in any
  // order don't get swallowed into the socket path.
  const socket =
    /^postgres(?:ql)?:\/\/([^:@/]+):([^@/]+)@\/([^?]+)\?(.+)$/.exec(
      connectionString,
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
  return postgres(connectionString, { prepare: false });
}

// Lazily instantiate the client on first use rather than at module load.
// Next.js evaluates the route module graph during `next build` (page-data
// collection) where DATABASE_URL is intentionally absent; connecting eagerly
// would throw and fail the build. Memoize so we open exactly one pool.
let instance: Database | undefined;

function getDb(): Database {
  if (!instance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    instance = drizzle(makeClient(connectionString), { schema });
  }
  return instance;
}

// Preserve the `db.select(...)` call-site API while deferring connection until
// the first property access (request time), not import time.
export const db: Database = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver) as unknown;
  },
});

export { schema };
