import { requireAuth } from "@/lib/auth/server";
import { getMyProfile, getRegions, isNotFoundApiError } from "@/lib/api/client";
import Image from "next/image";
import { isApiUnavailableError } from "@acme/shared/common/api-availability";
import { ApiUnavailable } from "@acme/ui/api-unavailable";
import { ProfileForm } from "@/components/profile-form";
import { redirect } from "next/navigation";
import { logError, logWarn } from "@/lib/logging";
import { env } from "@/env";
import { appsDirectoryUrl } from "@/lib/apps-directory";

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
    if (isApiUnavailableError(err)) {
      logWarn("me.profile.api_unavailable", {
        sessionUserId: session.userId,
        apiBaseUrl: process.env.F3_API_BASE_URL,
        lookup: "profile",
        err,
      });
      return <ProfileUnavailable />;
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
        lookup: "regions",
        err,
      });
      return <ProfileUnavailable />;
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

  return (
    <ProfileForm
      user={user}
      regions={regions}
      appsDirectoryUrl={
        appsDirectoryUrl(env.APPS_DIRECTORY_ENABLED, env.APPS_DIRECTORY_URL)
          ?.href ?? null
      }
    />
  );
}

function ProfileUnavailable() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <ApiUnavailable
        title="F3 Me is temporarily unavailable"
        message="The F3 Nation API is not responding, so your profile cannot load right now."
        logo={
          <Image
            src="/f3_logo.png"
            alt="F3 Nation"
            width={80}
            height={80}
            className="rounded-xl"
          />
        }
      />
    </div>
  );
}
