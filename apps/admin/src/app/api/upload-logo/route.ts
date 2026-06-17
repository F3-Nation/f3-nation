import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireAccessToken } from "~/lib/auth/server";
import { logError } from "~/lib/logging";
import { storage } from "~/lib/storage";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

function parseOptionalSize(
  sizeRaw: FormDataEntryValue | null,
): number | undefined | "invalid" {
  if (!sizeRaw) return undefined;
  const parsed = Number(sizeRaw);
  if (!Number.isFinite(parsed) || parsed <= 0) return "invalid";
  return parsed;
}

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
