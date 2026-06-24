import "server-only";
import { storage } from "@/lib/storage";

export async function uploadAvatar(
  userId: number,
  file: Buffer,
): Promise<string> {
  return storage.uploadUserAvatar(userId, file);
}
