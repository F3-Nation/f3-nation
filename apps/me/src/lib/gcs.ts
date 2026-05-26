import "server-only";
import { Storage } from "@google-cloud/storage";
import sharp from "sharp";

const emulatorHost = process.env.GCS_EMULATOR_HOST;

let storageClient: Storage | null = null;

function getStorage(): Storage {
  if (storageClient) return storageClient;

  const credsBase64 = process.env.GCS_CREDENTIALS;
  if (!credsBase64) throw new Error("GCS_CREDENTIALS is not set");

  let creds: { client_email: string; private_key: string };
  try {
    creds = JSON.parse(Buffer.from(credsBase64, "base64").toString()) as {
      client_email: string;
      private_key: string;
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid JSON";
    throw new Error(`Invalid GCS_CREDENTIALS payload: ${message}`);
  }

  if (!creds.client_email || !creds.private_key) {
    throw new Error(
      "GCS_CREDENTIALS is missing required service account fields",
    );
  }

  storageClient = new Storage({ credentials: creds });
  return storageClient;
}

export async function uploadAvatar(
  userId: number,
  file: Buffer,
): Promise<string> {
  const bucketName = process.env.GCS_BUCKET;
  if (!bucketName) throw new Error("GCS_BUCKET is not set");

  // Convert to JPEG, resize to max 512x512, strip metadata
  let jpeg: Buffer;
  try {
    jpeg = await sharp(file)
      .resize(512, 512, { fit: "cover", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown image error";
    throw new Error(`Failed to process avatar image: ${message}`);
  }

  const path = `user-avatars/${userId}.jpg`;

  if (emulatorHost) {
    const response = await fetch(
      `http://${emulatorHost}/upload/storage/v1/b/${bucketName}/o?uploadType=media&name=${path}`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer local-dev-token",
          "Content-Type": "image/jpeg",
        },
        body: jpeg,
      },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "(unreadable)");
      throw new Error(
        `GCS emulator upload failed: HTTP ${response.status} ${body}`,
      );
    }
    return `http://${emulatorHost}/${bucketName}/${path}`;
  }

  const bucket = getStorage().bucket(bucketName);
  const blob = bucket.file(path);

  await blob.save(jpeg, {
    // Avatars are capped at 5MB, so resumable uploads are unnecessary.
    // Forcing non-resumable avoids a google-auth resumable path that can
    // throw "URL is required" with some service-account configurations.
    resumable: false,
    metadata: {
      contentType: "image/jpeg",
      cacheControl: "public, max-age=300",
    },
  });

  return `https://storage.googleapis.com/${bucketName}/${path}`;
}

export async function deleteAvatar(userId: number): Promise<void> {
  const bucketName = process.env.GCS_BUCKET;
  if (!bucketName) throw new Error("GCS_BUCKET is not set");

  const path = `user-avatars/${userId}.jpg`;

  if (emulatorHost) {
    const encodedPath = encodeURIComponent(path);
    const response = await fetch(
      `http://${emulatorHost}/storage/v1/b/${bucketName}/o/${encodedPath}`,
      {
        method: "DELETE",
        headers: { Authorization: "Bearer local-dev-token" },
      },
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`GCS emulator delete failed: HTTP ${response.status}`);
    }
    return;
  }

  await getStorage()
    .bucket(bucketName)
    .file(path)
    .delete({ ignoreNotFound: true });
}
