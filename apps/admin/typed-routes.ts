// `next typegen` (run by `pnpm typecheck`) writes the typedRoutes declarations
// for `Link`, `useRouter` and `redirect` to `.next/types/link.d.ts`, but
// `next-env.d.ts` does not import that file and the tsconfig `exclude` of
// `.next` drops it from the `include` glob. An explicit import is not subject to
// `exclude`, so this pulls the route types into the program.
//
// This is a `.ts` file, not `.d.ts`, so that `tsc` fails (TS2882) when the
// generated file is missing. `skipLibCheck` hides that error, and a missing
// `/// <reference path>`, in a `.d.ts` file, so `typecheck` would otherwise
// pass while checking no hrefs.
import "./.next/types/link.d.ts";
