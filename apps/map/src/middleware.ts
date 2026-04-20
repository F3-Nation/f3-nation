import { NextResponse } from "next/server";

export function defaultMiddleware() {
  return NextResponse.next();
}
export default defaultMiddleware;

export const config = {
  matcher: [],
};
