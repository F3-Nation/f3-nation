# RCA — #315: Change Avatar rotates portrait selfies 90° clockwise

- **Issue:** [#315](https://github.com/F3-Nation/f3-nation/issues/315)
- **Reported by:** alanportugal (Pixel 9 Pro Fold, GrapheneOS)
- **Surface:** me.f3nation.com → Change Avatar
- **Severity:** Low (cosmetic, no data loss) · **Scope:** most Android users uploading portrait selfies

## Symptom

Uploading a portrait-orientation selfie via **Change Avatar** saves an avatar rotated 90° clockwise (head pointing right). Landscape photos upload correctly. Holding the phone rotated 90° CCW when shooting works around it.

## Root cause

Phone cameras (especially Android) capture portrait photos as **landscape pixel data plus an EXIF `Orientation` tag** — typically value `6`, meaning "rotate 90° CW for display." The viewer is expected to apply that rotation.

The avatar pipeline in `apps/me/src/lib/gcs.ts` (`uploadAvatar`) processed the upload with:

```ts
sharp(file)
  .resize(512, 512, { fit: "cover", withoutEnlargement: true })
  .jpeg({ quality: 85 })
  .toBuffer();
```

`sharp` does **not** auto-apply EXIF orientation unless `.rotate()` is called, and by default it **strips** metadata on output. So the pipeline:

1. read the raw (landscape) pixels, ignoring `Orientation: 6`;
2. cover-cropped and re-encoded them;
3. wrote a JPEG with no orientation tag.

The result is the un-rotated landscape image with the orientation hint discarded — which renders as a 90° CW rotation relative to what the user saw in their gallery. iPhone/iOS Safari often pre-bakes orientation, which is why the report is Android-specific.

The same latent defect existed in the shared `@acme/storage` `resizeImage` helper (same `sharp().resize().jpeg()` shape, no `.rotate()`), which the avatar-backfill migration (#260) uses — so a backfill would have re-introduced rotated avatars.

## Fix

Add `.rotate()` (no angle → auto-orient from EXIF) **before** `.resize()` so the crop operates on the correctly-oriented image:

- `apps/me/src/lib/gcs.ts`: extracted the pipeline into a testable `processAvatarImage(buffer)` and added `.rotate()`.
- `packages/storage/src/resize.ts`: added `.rotate()` for parity (defensive; covers the #260 backfill path).

`.rotate()` bakes the rotation into the pixels and resets orientation to "normal," so the stored JPEG is upright regardless of downstream viewers.

## Validation (red → green TDD)

New test: `apps/me/__tests__/lib/process-avatar-image.test.ts`.

It builds a 1024×512 **landscape** fixture (left half red, right half blue) tagged `Orientation = 6` **without rotating the pixels** — exactly how a phone stores a portrait photo — then asserts that after processing, the square avatar is **red on top / blue on bottom** (the orientation-6 rotation maps the left column to the top).

| Step  | State                        | Result                                                                                  |
| ----- | ---------------------------- | --------------------------------------------------------------------------------------- |
| RED   | pipeline without `.rotate()` | `top.r - top.b ≈ 0.01` (top half is ~50/50 red/blue → un-rotated landscape) → **fails** |
| GREEN | pipeline with `.rotate()`    | top half red, bottom half blue → **passes** (2/2)                                       |

This proves the fix addresses the reported behavior, not just a plausible-looking code change.

## Follow-ups / notes

- iOS is unaffected in practice (Safari pre-applies orientation) but the fix is orientation-agnostic and correct for all inputs.
- Org logo upload (`apps/map/.../upload-logo`) uses a separate code path; not in scope here. Worth a glance if logo rotation is ever reported.
