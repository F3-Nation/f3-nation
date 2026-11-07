// `next typegen` (run by `pnpm typecheck`) writes the typedRoutes declarations
// for `Link`, `useRouter` and `redirect` to `.next/types/link.d.ts`, but
// `next-env.d.ts` does not import that file and the tsconfig `exclude` of
// `.next` drops it from the `include` glob. An explicit import is not subject to
// `exclude`, so this pulls the route types into the program.
import "./.next/types/link.d.ts";
