import { getBucketName, getStorage } from "./client";
import { emulatorFetch, getEmulatorHost } from "./emulator";

export interface UploadFileOptions {
  cacheControl?: string;
}

/**
 * Upload a file to GCS and return its public URL.
 *
 * When `GCS_EMULATOR_HOST` is set the file is POSTed directly to the fake-gcs
 * server instead of using the GCS SDK (which requires real credentials).
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
  const emulatorHost = getEmulatorHost();

  if (emulatorHost) {
    const response = await emulatorFetch(
      `http://${emulatorHost}/upload/storage/v1/b/${bucketName}/o?uploadType=media&name=${path}`,
      {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: data as unknown as Uint8Array<ArrayBuffer>,
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
