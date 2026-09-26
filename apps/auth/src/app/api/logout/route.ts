import { NextResponse } from "next/server";

import { getCurrentSession } from "~/lib/current-session";
import { revokeAllUserTokens } from "~/lib/oauth";

export async function POST() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const userId = Number(session.user.id);
  if (userId) {
    await revokeAllUserTokens(userId);
  }

  return NextResponse.json({ loggedOut: true });
}
