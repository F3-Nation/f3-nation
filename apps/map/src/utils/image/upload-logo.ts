export async function uploadLogo({
  file,
  orgId,
  requestId,
}: {
  file: File | Blob;
  orgId: number;
  requestId: string;
}): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("orgId", orgId.toString());
  formData.append("requestId", requestId);

  const response = await fetch("/api/upload-logo", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(data?.error ?? "Failed to upload logo");
  }

  const data = (await response.json().catch(() => null)) as {
    url?: unknown;
  } | null;
  if (typeof data?.url !== "string" || data.url.length === 0) {
    throw new Error("Failed to upload logo");
  }
  return data.url;
}
