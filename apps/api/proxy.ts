// Or like this if you need to do something here.
// export default auth((req) => {
//   console.log(req.auth) //  { session: { user: { ... } } }
// })

import { NextResponse } from "next/server";

import withAdmin from "./middleware/with-admin";
import withEditor from "./middleware/with-editor";

export function defaultProxy() {
  return NextResponse.next();
}
export default withAdmin(withEditor(defaultProxy));

// Read more: https://nextjs.org/docs/app/building-your-application/routing/proxy#matcher
export const config = {
  matcher: ["/admin/:path*"],
};
