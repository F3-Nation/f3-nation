import "server-only";
import { prepareImageForStorage, uploadFile } from "@acme/storage";

export async function uploadAvatar(
  userId: number,
  file: Buffer,
): Promise<string> {
  const jpeg = await prepareImageForStorage(file, { width: 512, height: 512 });
  return uploadFile(`user-avatars/${userId}.jpg`, jpeg, "image/jpeg", {
    cacheControl: "public, max-age=300",
  });
}
