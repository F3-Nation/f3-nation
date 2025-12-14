import { auth } from "@acme/auth";

import { AlreadySignedIn } from "./already-signed-in";
import { SignIn } from "./sign-in";

export default async function SignInPage() {
  const session = await auth();
  return session?.user ? <AlreadySignedIn /> : <SignIn />;
}
