import { Storage } from "@google-cloud/storage";
import sharp from "sharp";

function getStorage(): Storage {
  const credsBase64 = process.env.GCS_CREDENTIALS;
  if (!credsBase64) throw new Error("GCS_CREDENTIALS is not set");

  const creds = JSON.parse(Buffer.from(credsBase64, "base64").toString());
  return new Storage({ credentials: creds });
}

export async function uploadAvatar(
  userId: number,
  file: Buffer,
): Promise<string> {
  const bucketName = process.env.GCS_BUCKET;
  if (!bucketName) throw new Error("GCS_BUCKET is not set");

  // Convert to JPEG, resize to max 512x512, strip metadata
  const jpeg = await sharp(file)
    .resize(512, 512, { fit: "cover", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  const bucket = getStorage().bucket(bucketName);
  const path = `user-avatars/${userId}.jpg`;
  const blob = bucket.file(path);

  await blob.save(jpeg, {
    metadata: {
      contentType: "image/jpeg",
      cacheControl: "public, max-age=300",
    },
  });

  return `https://storage.googleapis.com/${bucketName}/${path}`;
}
