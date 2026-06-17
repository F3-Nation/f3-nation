import { Storage } from "@google-cloud/storage";

import { emulatorFetch, getEmulatorHost } from "./emulator";
import { prepareImageForStorage } from "./resize";

const BUCKETS = {
  prod: "f3-public-images",
  staging: "f3-public-images-staging",
} as const;

export interface PublicImageStorage {
  uploadOrgLogo(
    orgId: number,
    file: Buffer,
    options?: { size?: number },
  ): Promise<string>;
  deleteOrgLogo(orgId: number): Promise<void>;
  uploadUserAvatar(
    userId: number,
    file: Buffer,
    options?: { size?: number },
  ): Promise<string>;
  deleteUserAvatar(userId: number): Promise<void>;
  isAllowedPublicImageUrl(url: string): boolean;
}

export function createPublicImageStorage(config: {
  channel: "staging" | "prod";
  credentials: string;
}): PublicImageStorage {
  const bucket = BUCKETS[config.channel];

  let storageClient: Storage | null = null;

  function getClient(): Storage {
    if (storageClient) return storageClient;
    let creds: { client_email: string; private_key: string };
    try {
      creds = JSON.parse(
        Buffer.from(config.credentials, "base64").toString(),
      ) as { client_email: string; private_key: string };
    } catch (err) {
      const message = err instanceof Error ? err.message : "invalid JSON";
      throw new Error(`Invalid GCS_CREDENTIALS payload: ${message}`);
    }
    if (!creds.client_email || !creds.private_key) {
      throw new Error(
        "GCS_CREDENTIALS is missing required service account fields",
      );
    }
    storageClient = new Storage({ credentials: creds });
    return storageClient;
  }

  async function uploadToBucket(
    path: string,
    data: Buffer,
    contentType: string,
  ): Promise<string> {
    const emulatorHost = getEmulatorHost();

    if (emulatorHost) {
      const encodedPath = encodeURIComponent(path);
      const response = await emulatorFetch(
        `http://${emulatorHost}/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodedPath}`,
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
      return `http://${emulatorHost}/${bucket}/${path}`;
    }

    const blob = getClient().bucket(bucket).file(path);
    await blob.save(data, {
      resumable: false,
      metadata: {
        contentType,
        cacheControl: "public, max-age=300",
      },
    });
    return `https://storage.googleapis.com/${bucket}/${path}`;
  }

  async function deleteFromBucket(path: string): Promise<void> {
    const emulatorHost = getEmulatorHost();

    if (emulatorHost) {
      const encodedPath = encodeURIComponent(path);
      const response = await emulatorFetch(
        `http://${emulatorHost}/storage/v1/b/${bucket}/o/${encodedPath}`,
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

    await getClient()
      .bucket(bucket)
      .file(path)
      .delete({ ignoreNotFound: true });
  }

  function isAllowedPublicImageUrl(url: string): boolean {
    if (
      url.startsWith(`https://storage.googleapis.com/${BUCKETS.prod}/`) ||
      url.startsWith(`https://storage.googleapis.com/${BUCKETS.staging}/`)
    ) {
      return true;
    }
    const emulatorHost = getEmulatorHost();
    if (emulatorHost) {
      return (
        url.startsWith(`http://${emulatorHost}/${BUCKETS.prod}/`) ||
        url.startsWith(`http://${emulatorHost}/${BUCKETS.staging}/`)
      );
    }
    return false;
  }

  return {
    async uploadOrgLogo(orgId, file, options) {
      const size = options?.size ?? 640;
      const jpg = await prepareImageForStorage(file, {
        width: size,
        height: size,
      });
      return uploadToBucket(`org-logos/${orgId}.jpg`, jpg, "image/jpeg");
    },

    async deleteOrgLogo(orgId) {
      await deleteFromBucket(`org-logos/${orgId}.jpg`);
    },

    async uploadUserAvatar(userId, file, options) {
      const size = options?.size ?? 512;
      const jpg = await prepareImageForStorage(file, {
        width: size,
        height: size,
      });
      return uploadToBucket(`user-avatars/${userId}.jpg`, jpg, "image/jpeg");
    },

    async deleteUserAvatar(userId) {
      await deleteFromBucket(`user-avatars/${userId}.jpg`);
    },

    isAllowedPublicImageUrl,
  };
}
