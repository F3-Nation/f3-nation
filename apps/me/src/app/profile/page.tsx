import { requireAuth } from "@/lib/auth/server";
import { getMyProfile, getRegions, isNotFoundApiError } from "@/lib/api/client";
import { ProfileForm } from "@/components/profile-form";
import { redirect } from "next/navigation";
import { logError, logWarn } from "@/lib/logging";

export default async function ProfilePage() {
  const session = await requireAuth();

  let user: Awaited<ReturnType<typeof getMyProfile>>;
  let regions: Awaited<ReturnType<typeof getRegions>>;

  try {
    [user, regions] = await Promise.all([getMyProfile(), getRegions()]);
  } catch (err) {
    if (isNotFoundApiError(err)) {
      logWarn("me.profile.user_not_found", {
        sessionUserId: session.userId,
        apiBaseUrl: process.env.F3_API_BASE_URL,
      });
      redirect("/?error=user_not_found");
    }

    logError(
      "me.profile.load_failed",
      {
        sessionUserId: session.userId,
        apiBaseUrl: process.env.F3_API_BASE_URL,
      },
      err,
    );
    throw err;
  }

  if (!user) {
    redirect("/?error=user_not_found");
  }

  return <ProfileForm user={user} regions={regions} />;
}
