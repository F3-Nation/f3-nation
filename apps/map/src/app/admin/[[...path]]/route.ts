import { redirect } from "next/navigation";

import { env } from "~/env";

const DEFAULT_ADMIN_URLS = {
  prod: "https://admin.f3nation.com",
  staging: "https://staging.admin.f3nation.com",
} as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const { path } = await params;
  const requestUrl = new URL(request.url);
  const baseUrl = (
    env.F3_ADMIN_URL ??
    DEFAULT_ADMIN_URLS[
      env.NEXT_PUBLIC_CHANNEL as keyof typeof DEFAULT_ADMIN_URLS
    ]
  )?.replace(/\/$/, "");

  if (!baseUrl) {
    redirect("/");
  }

  const adminPath = path?.map(encodeURIComponent).join("/") ?? "";
  redirect(`${baseUrl}/${adminPath}${requestUrl.search}`);
}
