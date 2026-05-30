export async function uploadLogo({
  file,
  orgId,
  size,
}: {
  file: File | Blob;
  orgId: number;
  size?: number;
}): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("orgId", orgId.toString());
  if (size) {
    formData.append("size", size.toString());
  }

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

  const data = (await response.json()) as { url: string };
  return data.url;
}
