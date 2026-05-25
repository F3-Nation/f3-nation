import { Storage } from "@google-cloud/storage";

let storageClient: Storage | null = null;

export function getStorage(): Storage {
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

export function getBucketName(): string {
  const bucketName = process.env.GCS_BUCKET;
  if (!bucketName) throw new Error("GCS_BUCKET is not set");
  return bucketName;
}
