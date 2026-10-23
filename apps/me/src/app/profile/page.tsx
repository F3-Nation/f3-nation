import { requireAuth } from "@/lib/auth/server";
import { getMyProfile, getRegions, isNotFoundApiError } from "@/lib/api/client";
import { ProfileForm } from "@/components/profile-form";
import { redirect } from "next/navigation";
import { isApiUnavailableError } from "@acme/shared/app/api-availability";
import { ApiUnavailable } from "@/components/api-unavailable";
import { logError, logWarn } from "@/lib/logging";

export default async function ProfilePage() {
  const session = await requireAuth();

  let user: Awaited<ReturnType<typeof getMyProfile>>;
  let regions: Awaited<ReturnType<typeof getRegions>>;

  try {
    user = await getMyProfile();
  } catch (err) {
    if (isNotFoundApiError(err)) {
      logWarn("me.profile.user_not_found", {
        sessionUserId: session.userId,
        apiBaseUrl: process.env.F3_API_BASE_URL,
      });
      redirect("/?error=user_not_found");
    }

    // The API is down or not answering: say so (and keep retrying) instead of
    // crashing the page.
    if (isApiUnavailableError(err)) {
      logWarn("me.profile.api_unavailable", {
        sessionUserId: session.userId,
        apiBaseUrl: process.env.F3_API_BASE_URL,
        err,
      });
      return <ApiUnavailable />;
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

  try {
    regions = await getRegions();
  } catch (err) {
    if (isApiUnavailableError(err)) {
      logWarn("me.profile.api_unavailable", {
        sessionUserId: session.userId,
        apiBaseUrl: process.env.F3_API_BASE_URL,
        err,
      });
      return <ApiUnavailable />;
    }

    logError(
      "me.profile.regions_failed",
      {
        sessionUserId: session.userId,
        apiBaseUrl: process.env.F3_API_BASE_URL,
      },
      err,
    );
    throw err;
  }

  return <ProfileForm user={user} regions={regions} />;
}
