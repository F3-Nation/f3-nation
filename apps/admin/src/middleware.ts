import { NextResponse } from "next/server";

import withAdmin from "./middleware/with-admin";
import withEditor from "./middleware/with-editor";

export function defaultMiddleware() {
  return NextResponse.next();
}
export default withAdmin(withEditor(defaultMiddleware));

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/auth).*)"],
};
