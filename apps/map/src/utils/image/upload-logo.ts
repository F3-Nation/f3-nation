export const uploadLogo = async ({
  file,
  orgId,
  requestId,
  size,
}: {
  file: Blob;
  orgId: number;
  requestId: string;
  size?: number;
}) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("orgId", orgId.toString());
  formData.append("requestId", requestId);
  if (size) {
    formData.append("size", size.toString());
  }

  const response = await fetch("/api/upload-logo", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Failed to upload logo");
  }
  console.log("response", response);

  const { url } = (await response.json()) as { url: string };
  return url;
};
