import { ORPCError } from "@orpc/server";

import type { PublicImageStorage } from "@acme/storage";
import { createPublicImageStorage, deriveStorageChannel } from "@acme/storage";

// Lazy singleton so importing the router doesn't require GCS env at module load
// (e.g. in tests that never touch image promotion).
let storage: PublicImageStorage | null = null;

export function getPublicImageStorage(): PublicImageStorage {
  if (storage) return storage;
  const credentials = process.env.GCS_CREDENTIALS;
  if (!credentials) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "GCS_CREDENTIALS is not set",
    });
  }
  storage = createPublicImageStorage({
    channel: deriveStorageChannel(process.env.F3_CHANNEL ?? ""),
    credentials,
  });
  return storage;
}
