import { NextResponse } from "next/server";

import { auth } from "@acme/auth";
import { parseOptionalSize } from "@acme/storage";

import { logError } from "~/lib/logging";
import { storage } from "~/lib/storage";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const orgIdRaw = formData.get("orgId");
  const sizeRaw = formData.get("size");
  const requestIdRaw = formData.get("requestId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const orgIdNum = Number(orgIdRaw);
  if (!orgIdRaw || !Number.isInteger(orgIdNum) || orgIdNum <= 0) {
    return NextResponse.json({ error: "Invalid orgId" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Invalid file type. Allowed: jpeg, png, webp, gif" },
      { status: 400 },
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum size is 10MB" },
      { status: 400 },
    );
  }

  const size = parseOptionalSize(sizeRaw);
  if (size === "invalid") {
    return NextResponse.json({ error: "Invalid size" }, { status: 400 });
  }

  // requestId keeps each pending change-request upload on its own path so it
  // does not overwrite the live org logo before the revision is approved.
  if (
    typeof requestIdRaw !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(requestIdRaw)
  ) {
    return NextResponse.json({ error: "Invalid requestId" }, { status: 400 });
  }
  const requestId = requestIdRaw;

  const orgId = orgIdNum;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await storage.uploadOrgLogo(orgId, buffer, { size, requestId });

    return NextResponse.json({ url });
  } catch (err) {
    logError("map.logo.upload_failed", { orgId }, err);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 },
    );
  }
}
