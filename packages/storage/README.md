# @acme/storage

Uploads, moves and deletes the public images the apps serve (org logos, user
avatars) in the `f3-public-images` buckets, and resizes them to JPEG first.
`createPublicImageStorage` picks the bucket from the channel: `prod` writes to
`f3-public-images`, every other channel to `f3-public-images-staging`.

## Authentication

Every caller passes exactly one `auth` mode. The package never falls back from
one mode to the other, so a missing grant fails instead of quietly using some
other credential.

| Mode                           | Credential                                                                                              | Use it when                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `{ kind: "identity" }`         | Application Default Credentials: on Cloud Run, the service's runtime service account. No stored secret. | Always, unless the app can't run as a service account.        |
| `{ kind: "key", key: string }` | A base64-encoded service-account key JSON                                                               | Only when the app runs somewhere it can't use a GCP identity. |

Prefer identity. A key is a long-lived secret that has to be stored, rotated
and kept out of logs, and a leaked key keeps working until someone deletes it.
An identity has no secret to leak, and its access ends when the grant is
removed.

With identity, the service's runtime service account needs
`roles/storage.objectUser` on its environment's bucket, limited by an IAM
condition to the folder the app writes. The folders are the path prefixes in
[`src/public-images.ts`](src/public-images.ts) (`org-logos/` for logos,
`user-avatars/` for avatars), so a new upload path needs a matching grant. The
commands are in
[GCP app setup § Public image uploads](../../docs/GCP_APP_SETUP.md#public-image-uploads).

`isStorageAccessDenied(err)` recognizes a GCS 403. Upload routes report it
apart from other failures, because the fix is a missing IAM grant rather than
a retry.

## Local development

With `GCS_EMULATOR_HOST` set, every call goes to the local fake-gcs-server and
no credential is read, whatever the `auth` mode. See
[Local dev with Docker § Google Cloud Storage](../../docs/LOCAL_DEV_DOCKER.md#google-cloud-storage-gcs-emulator).
