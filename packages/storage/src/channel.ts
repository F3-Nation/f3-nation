export type StorageChannel = "staging" | "prod";

/**
 * Only "prod" maps to the prod bucket; every other channel value
 * (local/dev/staging/branch/ci/etc.) maps to staging.
 */
export function deriveStorageChannel(channel: string): StorageChannel {
  return channel === "prod" ? "prod" : "staging";
}
