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
    options?: { size?: number; requestId?: string },
  ): Promise<string>;
  deleteOrgLogo(orgId: number): Promise<void>;
  uploadUserAvatar(
    userId: number,
    file: Buffer,
    options?: { size?: number },
  ): Promise<string>;
  deleteUserAvatar(userId: number): Promise<void>;
  isAllowedPublicImageUrl(url: string): boolean;
  /**
   * Promote a pending change-request logo (`org-logos/{orgId}-{requestId}.jpg`)
   * to the canonical org path (`org-logos/{orgId}.jpg`), overwriting any
   * existing logo and removing the pending file. Returns the canonical URL.
   * If the URL is not a pending logo, it is returned unchanged.
   */
  promoteOrgLogo(pendingUrl: string): Promise<string>;
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

  async function moveWithinBucket(src: string, dest: string): Promise<void> {
    const emulatorHost = getEmulatorHost();

    if (emulatorHost) {
      const response = await emulatorFetch(
        `http://${emulatorHost}/${bucket}/${encodeURI(src)}`,
      );
      if (!response.ok) {
        const body = await response.text().catch(() => "(unreadable)");
        throw new Error(
          `GCS emulator read failed: HTTP ${response.status} ${body}`,
        );
      }
      const data = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") ?? "image/jpeg";
      // uploadToBucket overwrites dest; deleteFromBucket removes the pending file.
      await uploadToBucket(dest, data, contentType);
      await deleteFromBucket(src);
      return;
    }

    // file.move() copies to dest (overwriting) then deletes src.
    await getClient().bucket(bucket).file(src).move(dest);
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

  function assertPositiveIntegerId(label: "orgId" | "userId", value: number) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${label} must be a positive integer`);
    }
    return value;
  }

  function assertOptionalRequestId(value: string | undefined): string {
    if (value == null) return "";
    // Path-safe only: requestId is a client-supplied UUID. Reject anything
    // that could escape the org-logos/{orgId} key space.
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error("requestId must be alphanumeric, dash, or underscore");
    }
    return `-${value}`;
  }

  function assertPositiveIntegerSize(
    value: number | undefined,
    fallback: number,
  ) {
    const size = value ?? fallback;
    if (!Number.isInteger(size) || size <= 0) {
      throw new Error("size must be a positive integer");
    }
    return size;
  }

  return {
    async uploadOrgLogo(orgId, file, options) {
      assertPositiveIntegerId("orgId", orgId);
      const size = assertPositiveIntegerSize(options?.size, 640);
      const suffix = assertOptionalRequestId(options?.requestId);
      const jpg = await prepareImageForStorage(file, {
        width: size,
        height: size,
      });
      // requestId isolates pending change-request uploads so they don't
      // overwrite the live org logo before the revision is approved.
      return uploadToBucket(
        `org-logos/${orgId}${suffix}.jpg`,
        jpg,
        "image/jpeg",
      );
    },

    async deleteOrgLogo(orgId) {
      assertPositiveIntegerId("orgId", orgId);
      await deleteFromBucket(`org-logos/${orgId}.jpg`);
    },

    async uploadUserAvatar(userId, file, options) {
      assertPositiveIntegerId("userId", userId);
      const size = assertPositiveIntegerSize(options?.size, 512);
      const jpg = await prepareImageForStorage(file, {
        width: size,
        height: size,
      });
      return uploadToBucket(`user-avatars/${userId}.jpg`, jpg, "image/jpeg");
    },

    async deleteUserAvatar(userId) {
      assertPositiveIntegerId("userId", userId);
      await deleteFromBucket(`user-avatars/${userId}.jpg`);
    },

    async promoteOrgLogo(pendingUrl) {
      if (!isAllowedPublicImageUrl(pendingUrl)) {
        throw new Error("promoteOrgLogo: url is not an allowed public image");
      }
      const marker = `/${bucket}/`;
      const idx = pendingUrl.indexOf(marker);
      if (idx === -1) {
        throw new Error("promoteOrgLogo: url is not in this channel's bucket");
      }
      const base = pendingUrl.slice(0, idx + marker.length);
      const path = pendingUrl.slice(idx + marker.length).split("?")[0] ?? "";
      const match = /^org-logos\/(\d+)-[A-Za-z0-9_-]+\.jpg$/.exec(path);
      // Already canonical (or some other path): nothing to promote.
      if (!match) return pendingUrl;

      const canonicalPath = `org-logos/${match[1]}.jpg`;
      await moveWithinBucket(path, canonicalPath);
      return `${base}${canonicalPath}`;
    },

    isAllowedPublicImageUrl,
  };
}
