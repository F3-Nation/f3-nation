import type { NextProxy } from "next/server";

export type MiddlewareFactory = (middleware: NextProxy) => NextProxy;
