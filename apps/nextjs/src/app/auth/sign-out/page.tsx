import { auth } from "@acme/auth";

import { SignOut } from "./sign-out";

export default async function SignOutPage() {
  const session = await auth();
  return <SignOut session={session} />;
}
