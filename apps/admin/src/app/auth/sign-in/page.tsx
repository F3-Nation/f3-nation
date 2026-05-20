import { getSessionUser } from "~/lib/auth/server";

import { AlreadySignedIn } from "./already-signed-in";
import { SignIn } from "./sign-in";

export default async function SignInPage() {
  const session = await getSessionUser();
  return session ? <AlreadySignedIn session={session} /> : <SignIn />;
}
