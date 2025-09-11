import axios from "axios";

export const uploadLogo = async ({
  file,
  regionId,
  requestId,
  size,
}: {
  file: Blob;
  regionId: number;
  requestId: string;
  size?: number;
}) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("regionId", regionId.toString());
  formData.append("requestId", requestId);
  if (size) {
    formData.append("size", size.toString());
  }

  const response = await axios.post<{ url: string }>(
    "/api/upload-logo",
    formData,
  );

  if (response.status !== 200) {
    throw new Error("Failed to upload logo");
  }
  console.log("response", response);

  const { url } = response.data;
  return url;
};
