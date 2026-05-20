import { getBucketName, getStorage } from "./client";

export interface UploadFileOptions {
  cacheControl?: string;
}

/**
 * Upload a file to GCS and return its public URL.
 *
 * @param path - Object path within the bucket (e.g. "user-avatars/42.jpg")
 * @param data - File contents as a Buffer
 * @param contentType - MIME type (e.g. "image/jpeg")
 */
export async function uploadFile(
  path: string,
  data: Buffer,
  contentType: string,
  options?: UploadFileOptions,
): Promise<string> {
  const bucketName = getBucketName();
  const bucket = getStorage().bucket(bucketName);
  const blob = bucket.file(path);

  await blob.save(data, {
    // Non-resumable avoids a google-auth resumable path that can
    // throw "URL is required" with some service-account configurations.
    resumable: false,
    metadata: {
      contentType,
      cacheControl: options?.cacheControl ?? "public, max-age=300",
    },
  });

  return `https://storage.googleapis.com/${bucketName}/${path}`;
}
