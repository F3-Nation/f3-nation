import "server-only";
import { createPublicImageStorage, deriveStorageChannel } from "@acme/storage";
import { env } from "~/env";

export const storage = createPublicImageStorage({
  channel: deriveStorageChannel(env.F3_CHANNEL),
  credentials: env.GCS_CREDENTIALS,
});
