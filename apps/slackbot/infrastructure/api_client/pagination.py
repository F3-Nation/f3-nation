"""
Pagination helper for F3 Nation REST API list endpoints.

As of #910, the API caps an unpaginated request (one that omits both
``pageIndex`` and ``pageSize``) to a single default-sized page instead of
returning every matching row (see ``packages/api/src/lib/pagination.ts``).
Callers that need the full result set must page through it explicitly via
``fetch_all_pages`` instead of relying on the old "everything in one page"
behavior.

``MAX_PAGE_SIZE`` mirrors the API's own cap (``packages/api/src/lib/
pagination.ts``) and the TS ``useFetchAllPages`` hooks (apps/admin,
apps/map) -- all three must stay in sync.
"""

from __future__ import annotations

from typing import Any

from infrastructure.api_client.client import F3ApiClient

MAX_PAGE_SIZE = 100


def fetch_all_pages(
    client: F3ApiClient,
    path: str,
    params: dict[str, Any],
    items_key: str,
    total_key: str = "totalCount",
) -> list[dict]:
    """Page through a list endpoint and return every matching row.

    *items_key* is the response key holding a page's rows (e.g. ``"orgs"``,
    ``"eventTags"``). *total_key* is the response key holding the overall
    row count -- ``/v1/org`` uses ``"total"``; every other list route used
    here uses ``"totalCount"``.
    """
    all_items: list[dict] = []
    page_index = 0
    while True:
        page_params = {**params, "pageSize": MAX_PAGE_SIZE, "pageIndex": page_index}
        result = client.get(path, params=page_params)
        items: list[dict] = result.get(items_key) or result.get("results") or []
        all_items.extend(items)
        total = result.get(total_key)
        if total is not None and len(all_items) >= total:
            break
        if len(items) < MAX_PAGE_SIZE:
            break
        page_index += 1
    return all_items
