import { Storage } from "@google-cloud/storage";

function getStorage(): Storage {
  const credsBase64 = process.env.GCS_CREDENTIALS;
  if (!credsBase64) throw new Error("GCS_CREDENTIALS is not set");

  const creds = JSON.parse(Buffer.from(credsBase64, "base64").toString());
  return new Storage({ credentials: creds });
}

export async function uploadAvatar(
  userId: number,
  file: Buffer,
  filename: string,
  contentType: string,
): Promise<string> {
  const bucketName = process.env.GCS_BUCKET;
  if (!bucketName) throw new Error("GCS_BUCKET is not set");

  const bucket = getStorage().bucket(bucketName);
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `avatars/${userId}/${Date.now()}-${sanitizedFilename}`;
  const blob = bucket.file(path);

  await blob.save(file, {
    metadata: { contentType },
    public: true,
  });

  return `https://storage.googleapis.com/${bucketName}/${path}`;
}
