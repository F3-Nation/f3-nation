import { NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";

import { env } from "@acme/env";

export async function POST(request: Request) {
  try {
    // Get the file from the request
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const regionId = formData.get("regionId") as string;
    const requestId = formData.get("requestId") as string;
    const size = formData.get("size") as string | undefined;

    if (!file || !regionId || !requestId) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Initialize Google Auth
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

    // Get auth client and token
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    // Generate a unique filename (you might want to customize this)
    const filename = `${regionId}-${requestId}${size ? `-${size}` : ""}.${file.type.split("/")[1]}`;

    // Upload to Google Cloud Storage
    const response = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${env.GOOGLE_LOGO_BUCKET_BUCKET_NAME}/o?uploadType=media&name=${filename}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.token}`,
          "Content-Type": file.type,
        },
        body: await file.arrayBuffer(),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to upload to Google Cloud Storage");
    }

    // Return the public URL of the uploaded file
    const publicUrl = `https://storage.googleapis.com/${env.GOOGLE_LOGO_BUCKET_BUCKET_NAME}/${filename}`;
    return NextResponse.json({ url: publicUrl });
  } catch (error) {
    console.error("Error uploading file:", error);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 },
    );
  }
}
