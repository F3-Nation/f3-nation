import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { prepareImageForStorage, uploadFile } from "@acme/storage";

import { requireAccessToken } from "~/lib/auth/server";
import { logError } from "~/lib/logging";

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

  if (!orgIdRaw || isNaN(Number(orgIdRaw))) {
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

  const orgId = Number(orgIdRaw);
  const dimension = sizeRaw ? Number(sizeRaw) : 640;

  try {
    const buffer = Buffer.from(await fileEntry.arrayBuffer());
    const jpeg = await prepareImageForStorage(buffer, {
      width: dimension,
      height: dimension,
    });
    const url = await uploadFile(`org-logos/${orgId}.jpg`, jpeg, "image/jpeg");

    return NextResponse.json({ url });
  } catch (err) {
    logError("admin.logo.upload_failed", { orgId }, err);
    return NextResponse.json(
      { error: "Failed to upload logo" },
      { status: 500 },
    );
  }
}
