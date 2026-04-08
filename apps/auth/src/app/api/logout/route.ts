import { NextResponse } from "next/server";

import { auth } from "~/lib/auth";
import { revokeAllUserTokens } from "~/lib/oauth";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const userId = Number(session.user.id);
  if (userId) {
    await revokeAllUserTokens(userId);
  }

  return NextResponse.json({ loggedOut: true });
}
