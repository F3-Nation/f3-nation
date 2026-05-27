import "server-only";
import { deleteFile, prepareImageForStorage, uploadFile } from "@acme/storage";

export async function uploadAvatar(
  userId: number,
  file: Buffer,
): Promise<string> {
  const jpeg = await prepareImageForStorage(file, { width: 512, height: 512 });
  return uploadFile(`user-avatars/${userId}.jpg`, jpeg, "image/jpeg", {
    cacheControl: "public, max-age=300",
  });
}

export async function deleteAvatar(userId: number): Promise<void> {
  await deleteFile(`user-avatars/${userId}.jpg`);
}
