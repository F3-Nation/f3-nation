import "server-only";
import { createPublicImageStorage } from "@acme/storage";
import { env } from "@/env";

function deriveStorageChannel(channel: string): "staging" | "prod" {
  return channel === "prod" ? "prod" : "staging";
}

export const storage = createPublicImageStorage({
  channel: deriveStorageChannel(env.F3_CHANNEL),
  credentials: env.GCS_CREDENTIALS,
});
