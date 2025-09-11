/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1)
 * 2. You want to create a new middleware or type of procedure (see Part 3)
 *
 * tl;dr - this is where all the tRPC server stuff is created and plugged in.
 * The pieces you will need to use are documented accordingly near the end
 */
import type { OpenApiMeta } from "trpc-openapi";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import type { Session } from "@acme/auth";
import { auth } from "@acme/auth";
import { db } from "@acme/db/client";
import { env } from "@acme/env";

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: {
  headers: Headers | null | Promise<Headers | null>;
  session: Session | null | "none";
}) => {
  const headers = await opts.headers;
  const session =
    opts.session === "none" ? null : opts.session ?? (await auth());
  const source = headers?.get("x-trpc-source") ?? "unknown";
  const xRealIp = headers?.get("x-real-ip") ?? "unknown";
  const xForwardedFor = headers?.get("x-forwarded-for") ?? "unknown";
  const apiKey = headers?.get("x-api-key") ?? "unknown";
  const apiKeyStatus = apiKey === env.SUPER_ADMIN_API_KEY ? "valid" : "invalid";

  const ip = xForwardedFor ?? xRealIp;

  console.log(
    ">>> tRPC Request from",
    source,
    "by",
    session?.user?.email ?? "a guest",
    "at",
    ip,
  );

  return {
    session,
    ip,
    db,
    apiKeyStatus,
  };
};

/**
 * 2. INITIALIZATION
 *
 * This is where the trpc api is initialized, connecting the context and
 * transformer
 */
const t = initTRPC
  .meta<OpenApiMeta>()
  .context<Context>()
  .create({
    transformer: superjson,
    errorFormatter: ({ shape, error }) => ({
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    }),
  });

/**
 * Create a server-side caller
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these
 * a lot in the /src/server/api/routers folder
 */

/**
 * This is how you create new routers and subrouters in your tRPC API
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Public (unauthed) procedure
 *
 * This is the base piece you use to build new queries and mutations on your
 * tRPC API. It does not guarantee that a user querying is authorized, but you
 * can still access user session data if they are logged in
 */
export const publicProcedure = t.procedure;

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      // infers the `session` as non-nullable
      session: { ...ctx.session, user: ctx.session.user },
    },
  });
});

export const editorProcedure = protectedProcedure.use(({ ctx, next }) => {
  const isEditorOrAdmin = ctx.session?.roles?.some((r) =>
    ["editor", "admin"].includes(r.roleName),
  );
  if (!isEditorOrAdmin) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx });
});

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  const isAdmin = ctx.session?.roles?.some((r) => r.roleName === "admin");
  if (!isAdmin) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx });
});

export const apiKeyProcedure = publicProcedure.use(({ ctx, next }) => {
  if (ctx.apiKeyStatus !== "valid") {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx });
});
