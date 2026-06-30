import { NextResponse } from "next/server";

export function defaultProxy() {
  return NextResponse.next();
}
export default defaultProxy;

export const config = {
  matcher: [],
};
