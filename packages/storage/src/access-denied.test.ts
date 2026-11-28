import { describe, expect, it } from "vitest";

import { isStorageAccessDenied } from "./access-denied";

// @google-cloud/storage throws a GaxiosError carrying the HTTP status as
// `status` and `response.status`, and copies it onto `code`.
function gcsError(status: number) {
  return Object.assign(
    new Error(
      "svc@proj.iam.gserviceaccount.com does not have storage.objects.create access",
    ),
    { code: status, status, response: { status } },
  );
}

describe("isStorageAccessDenied", () => {
  it("is true for a GCS 403", () => {
    expect(isStorageAccessDenied(gcsError(403))).toBe(true);
  });

  it("is true when only the response carries the 403", () => {
    expect(isStorageAccessDenied({ response: { status: 403 } })).toBe(true);
  });

  it("is false for other GCS statuses", () => {
    expect(isStorageAccessDenied(gcsError(404))).toBe(false);
    expect(isStorageAccessDenied(gcsError(500))).toBe(false);
  });

  it("is false for errors without a status", () => {
    expect(isStorageAccessDenied(new Error("boom"))).toBe(false);
    expect(isStorageAccessDenied("403")).toBe(false);
    expect(isStorageAccessDenied(null)).toBe(false);
  });
});
