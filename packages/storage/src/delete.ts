import { getBucketName, getStorage } from "./client";
import { emulatorFetch, getEmulatorHost } from "./emulator";

/**
 * Delete a file from GCS. No-ops if the file does not exist.
 *
 * When `GCS_EMULATOR_HOST` is set the request is sent directly to the
 * fake-gcs server instead of using the GCS SDK.
 *
 * @param path - Object path within the bucket (e.g. "user-avatars/42.jpg")
 */
export async function deleteFile(path: string): Promise<void> {
  const bucketName = getBucketName();
  const emulatorHost = getEmulatorHost();

  if (emulatorHost) {
    const encodedPath = encodeURIComponent(path);
    const response = await emulatorFetch(
      `http://${emulatorHost}/storage/v1/b/${bucketName}/o/${encodedPath}`,
      { method: "DELETE" },
    );
    if (!response.ok && response.status !== 404) {
      const body = await response.text().catch(() => "(unreadable)");
      throw new Error(
        `GCS emulator delete failed: HTTP ${response.status} ${body}`,
      );
    }
    return;
  }

  await getStorage()
    .bucket(bucketName)
    .file(path)
    .delete({ ignoreNotFound: true });
}
