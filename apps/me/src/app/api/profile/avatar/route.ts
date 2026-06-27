import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { uploadAvatar } from "@/lib/gcs";
import {
  isNotFoundApiError,
  updateMyProfile,
  getMyProfile,
} from "@/lib/api/client";
import { logError } from "@/lib/logging";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

function mapAvatarUploadError(err: unknown): { status: number; error: string } {
  const message = err instanceof Error ? err.message : "";
  const lower = message.toLowerCase();

  if (lower.includes("invalid_grant") && lower.includes("account not found")) {
    return {
      status: 503,
      error:
        "Avatar storage is misconfigured: GCS service account was not found. Update GCS_CREDENTIALS.",
    };
  }

  if (
    lower.includes("invalid gcs_credentials payload") ||
    lower.includes("gcs_credentials is missing required")
  ) {
    return {
      status: 500,
      error: "Avatar storage is not configured. Set GCS_CREDENTIALS.",
    };
  }

  if (isNotFoundApiError(err)) {
    return {
      status: 404,
      error: "User profile not found for this session.",
    };
  }

  return { status: 500, error: "Failed to upload avatar" };
}

export async function POST(request: NextRequest) {
  let sessionUserId: number | undefined;

  try {
    const session = await requireAuth();
    const userId = session.userId;
    sessionUserId = userId;

    const formData = await request.formData();
    const fileEntry = formData.get("file");

    if (!(fileEntry instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const file = fileEntry;

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: jpeg, png, webp" },
        { status: 400 },
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5MB" },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Preflight: verify the profile exists before touching GCS.
    // Aborts early with 404 if the user has no profile, preventing
    // unnecessary overwrites of the canonical GCS object.
    await getMyProfile();

    // Upload converts to JPEG and saves as user-avatars/{userId}.jpg
    const avatarUrl = await uploadAvatar(userId, buffer);

    // Update user's avatarUrl via the me API
    try {
      await updateMyProfile({ avatarUrl });
    } catch (profileErr) {
      // uploadAvatar writes to a stable path (user-avatars/{userId}.jpg),
      // The new GCS content is already at the canonical path;
      // if the DB update failed the user simply retrying will succeed without data loss.
      throw profileErr;
    }

    // Return a cache-busted URL to the client so the browser fetches the new
    // image immediately. The clean URL (without ?v=) is stored in the DB;
    // useProfileForm derives the busted URL from user.updated on page load.
    return NextResponse.json({ avatarUrl: `${avatarUrl}?v=${Date.now()}` });
  } catch (err) {
    if (err instanceof Error && err.message.includes("NEXT_REDIRECT"))
      throw err;

    logError(
      "me.avatar.upload_failed",
      {
        sessionUserId,
        apiBaseUrl: process.env.F3_API_BASE_URL,
      },
      err,
    );

    const mapped = mapAvatarUploadError(err);
    return NextResponse.json(
      { error: mapped.error },
      { status: mapped.status },
    );
  }
}
