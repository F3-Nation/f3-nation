import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { REGIONS } from "../../../../data/regions";

const DEFAULT_PAGE_SIZE = 100;
const API_KEY = process.env.API_KEY;

export const GET = async (request: NextRequest) => {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 },
    );
  }

  const providedApiKey =
    request.headers.get("x-api-key") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (providedApiKey !== API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requestedPage = Number(searchParams.get("page"));
  const requestedPageSize = Number(searchParams.get("pageSize"));

  const pageSize =
    Number.isFinite(requestedPageSize) && requestedPageSize > 0
      ? Math.floor(requestedPageSize)
      : DEFAULT_PAGE_SIZE;
  const total = REGIONS.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const page =
    Number.isFinite(requestedPage) && requestedPage > 0
      ? Math.min(Math.floor(requestedPage), totalPages)
      : 1;

  const start = (page - 1) * pageSize;
  const data = REGIONS.slice(start, start + pageSize);

  return NextResponse.json({
    data,
    metadata: {
      page,
      pageSize,
      total,
      totalPages,
      next: page < totalPages ? page + 1 : null,
      prev: page > 1 ? page - 1 : null,
    },
  });
};
