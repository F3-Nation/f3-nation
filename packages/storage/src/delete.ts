import { getBucketName, getStorage } from "./client";

/**
 * Delete a file from GCS. No-ops if the file does not exist.
 *
 * @param path - Object path within the bucket (e.g. "user-avatars/42.jpg")
 */
export async function deleteFile(path: string): Promise<void> {
  const bucketName = getBucketName();
  await getStorage()
    .bucket(bucketName)
    .file(path)
    .delete({ ignoreNotFound: true });
}
