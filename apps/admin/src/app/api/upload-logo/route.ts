import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isApiUnavailableError } from "@acme/shared/common/api-availability";
import { parseOptionalSize } from "@acme/storage";

import { getOrgParentId } from "~/lib/api/client";
import { canEditOrg } from "~/lib/auth/org-access";
import { getSessionLookup, requireAccessToken } from "~/lib/auth/server";
import { logError, logWarn } from "~/lib/logging";
import { storage } from "~/lib/storage";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(request: NextRequest) {
  await requireAccessToken();

  const formData = await request.formData();
  const fileEntry = formData.get("file");
  const orgIdRaw = formData.get("orgId");
  const sizeRaw = formData.get("size");

  if (!(fileEntry instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const orgIdNum = Number(orgIdRaw);
  if (!orgIdRaw || !Number.isInteger(orgIdNum) || orgIdNum <= 0) {
    return NextResponse.json({ error: "Invalid orgId" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(fileEntry.type)) {
    return NextResponse.json(
      { error: "Invalid file type. Allowed: jpeg, png, webp, gif" },
      { status: 400 },
    );
  }

  if (fileEntry.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum size is 10MB" },
      { status: 400 },
    );
  }

  const size = parseOptionalSize(sizeRaw);
  if (size === "invalid") {
    return NextResponse.json({ error: "Invalid size" }, { status: 400 });
  }

  const orgId = orgIdNum;

  // The logo is public and keyed only by org id, so only an editor or admin
  // of that org, or of an org above it, may replace it.
  const apiUnavailableResponse = () =>
    NextResponse.json(
      { error: "The F3 API is unavailable. Please try again." },
      { status: 503 },
    );
  try {
    const { session, apiUnavailable } = await getSessionLookup();
    if (apiUnavailable) return apiUnavailableResponse();
    if (!session || !(await canEditOrg(orgId, session.roles, getOrgParentId))) {
      logWarn("admin.logo.upload_forbidden", { orgId });
      return NextResponse.json(
        { error: "You are not allowed to change this org's logo" },
        { status: 403 },
      );
    }
  } catch (err) {
    if (isApiUnavailableError(err)) return apiUnavailableResponse();
    logError("admin.logo.authorize_failed", { orgId }, err);
    return NextResponse.json(
      { error: "Failed to upload logo" },
      { status: 500 },
    );
  }

  try {
    const buffer = Buffer.from(await fileEntry.arrayBuffer());
    const url = await storage.uploadOrgLogo(orgId, buffer, { size });

    return NextResponse.json({ url });
  } catch (err) {
    logError("admin.logo.upload_failed", { orgId }, err);
    return NextResponse.json(
      { error: "Failed to upload logo" },
      { status: 500 },
    );
  }
}
