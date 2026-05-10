import { GoogleAuth } from "google-auth-library";
import { NextResponse } from "next/server";

import { env } from "@acme/env";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const orgId = formData.get("orgId") as string;
    const requestId = formData.get("requestId") as string;
    const size = formData.get("size") as string | undefined;

    if (!file || !orgId || !requestId) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const filename = `${orgId}-${requestId}${size ? `-${size}` : ""}.${file.type.split("/")[1]}`;
    const bucket = env.GOOGLE_LOGO_BUCKET_BUCKET_NAME;
    const isEmulator = !!env.GCS_EMULATOR_HOST;
    const gcsBase = isEmulator
      ? `http://${env.GCS_EMULATOR_HOST}`
      : "https://storage.googleapis.com";

    let bearerToken: string;
    if (isEmulator) {
      bearerToken = "local-dev-token";
    } else {
      const auth = new GoogleAuth({
        credentials: {
          private_key: env.GOOGLE_LOGO_BUCKET_PRIVATE_KEY.replace(
            /\\\n/g,
            "\n",
          ).replace(/\\n/g, "\n"),
          client_email: env.GOOGLE_LOGO_BUCKET_CLIENT_EMAIL,
        },
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });
      const client = await auth.getClient();
      const tokenResult = await client.getAccessToken();
      bearerToken = tokenResult.token ?? "";
    }

    const response = await fetch(
      `${gcsBase}/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${filename}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": file.type,
        },
        body: await file.arrayBuffer(),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to upload to Google Cloud Storage");
    }

    const publicUrl = isEmulator
      ? `http://${env.GCS_EMULATOR_HOST}/${bucket}/${filename}`
      : `https://storage.googleapis.com/${bucket}/${filename}`;

    return NextResponse.json({ url: publicUrl });
  } catch (error) {
    console.error("Error uploading file:", error);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 },
    );
  }
}
