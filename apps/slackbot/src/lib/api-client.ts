import type {
  RegionResponse,
  SlackSpaceResponse,
  SlackUserData,
  SlackUserResponse,
  SuccessActionResponse,
  UpdateSpaceSettingsInput,
  UpsertUserInput,
  GetOrCreateSpaceInput,
  GetOrCreateUserInput,
  LocationListResponse,
  LocationResponse,
  LocationInput,
} from "../types/api-types";
import { logger } from "./logger";

// API base URL - defaults to local development
const API_BASE_URL = process.env.API_URL ?? "http://localhost:3000/v1";
const API_KEY = process.env.SLACKBOT_API_KEY;

logger.info(`API_BASE_URL initialized as: ${API_BASE_URL}`);

/**
 * Simple fetch-based API client for oRPC endpoints
 * This is a simplified client for Phase 0 - will be enhanced with proper oRPC client in later phases
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(API_KEY
          ? {
              "x-api-key": API_KEY,
              Authorization: `Bearer ${API_KEY}`,
              client: "slackbot",
            }
          : {}),
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(
        `API request failed: ${response.status} ${response.statusText}`,
      );
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  } catch (error) {
    logger.error(`API request to ${endpoint} failed`, error);
    throw error;
  }
}

/**
 * API client with typed methods for common operations
 */
export const api = {
  ping: () => apiRequest<{ message: string }>("/ping"),

  slack: {
    getSpace: (teamId: string) =>
      apiRequest<SlackSpaceResponse | null>(
        `/slack/space?teamId=${encodeURIComponent(teamId)}`,
      ),

    updateSpaceSettings: (teamId: string, settings: UpdateSpaceSettingsInput) =>
      apiRequest<{ success: boolean }>(`/slack/space/settings`, {
        method: "PATCH",
        body: JSON.stringify({ teamId, settings }),
      }),

    getUserBySlackId: (slackId: string, teamId: string) =>
      apiRequest<SlackUserResponse | null>(
        `/slack/user?slackId=${encodeURIComponent(slackId)}&teamId=${encodeURIComponent(teamId)}`,
      ),

    getOrCreateSpace: (input: GetOrCreateSpaceInput) =>
      apiRequest<SlackSpaceResponse>(`/slack/get-or-create-space`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    getOrCreateUser: (input: GetOrCreateUserInput) =>
      apiRequest<SlackUserData>(`/slack/get-or-create-user`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    upsertUser: (input: UpsertUserInput) =>
      apiRequest<SuccessActionResponse>(`_action/slack/user`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),

    getRegion: (teamId: string) =>
      apiRequest<RegionResponse | null>(
        `/slack/region?teamId=${encodeURIComponent(teamId)}`,
      ),
  },

  location: {
    all: (params: {
      regionIds?: number[];
      searchTerm?: string;
      onlyMine?: boolean;
    }) => {
      const searchParams = new URLSearchParams();
      if (params.searchTerm)
        searchParams.append("searchTerm", params.searchTerm);
      if (params.onlyMine) searchParams.append("onlyMine", "true");
      if (params.regionIds) {
        params.regionIds.forEach((id) =>
          searchParams.append("regionIds", id.toString()),
        );
      }
      return apiRequest<LocationListResponse>(
        `/location?${searchParams.toString()}`,
      );
    },

    crupdate: (input: LocationInput) =>
      apiRequest<{ location: LocationResponse }>(`/location`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    byId: (input: { id: number }) =>
      apiRequest<{ location: LocationResponse | null }>(
        `/location/id/${input.id}`,
      ),

    delete: (id: number) =>
      apiRequest<{ locationId: number }>(`/location/delete/${id}`, {
        method: "DELETE",
      }),
  },

  org: {
    all: (params: {
      orgTypes: ("ao" | "region" | "area" | "sector" | "nation")[];
      parentOrgIds?: number[];
      statuses?: ("active" | "inactive")[];
      searchTerm?: string;
      pageIndex?: number;
      pageSize?: number;
    }) => {
      const searchParams = new URLSearchParams();
      params.orgTypes.forEach((t) => searchParams.append("orgTypes", t));
      if (params.parentOrgIds) {
        params.parentOrgIds.forEach((id) =>
          searchParams.append("parentOrgIds", id.toString()),
        );
      }
      if (params.statuses) {
        params.statuses.forEach((s) => searchParams.append("statuses", s));
      }
      if (params.searchTerm)
        searchParams.append("searchTerm", params.searchTerm);
      if (params.pageIndex !== undefined)
        searchParams.append("pageIndex", params.pageIndex.toString());
      if (params.pageSize !== undefined)
        searchParams.append("pageSize", params.pageSize.toString());
      return apiRequest<{
        orgs: OrgResponse[];
        total: number;
      }>(`/org?${searchParams.toString()}`);
    },

    byId: (input: { id: number; orgType?: string }) => {
      const searchParams = new URLSearchParams();
      if (input.orgType) searchParams.append("orgType", input.orgType);
      const query = searchParams.toString();
      return apiRequest<{ org: OrgResponse | null }>(
        `/org/id/${input.id}${query ? `?${query}` : ""}`,
      );
    },

    crupdate: (input: OrgInput) =>
      apiRequest<{ org: OrgResponse | null }>(`/org`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    delete: (input: { id: number; orgType?: string }) =>
      apiRequest<{ orgId: number }>(`/org/delete/${input.id}`, {
        method: "DELETE",
        body: JSON.stringify({ orgType: input.orgType }),
      }),
  },

  eventType: {
    all: (params: {
      orgIds?: number[];
      statuses?: ("active" | "inactive")[];
      ignoreNationEventTypes?: boolean;
    }) => {
      const searchParams = new URLSearchParams();
      if (params.orgIds) {
        params.orgIds.forEach((id) =>
          searchParams.append("orgIds", id.toString()),
        );
      }
      if (params.statuses) {
        params.statuses.forEach((s) => searchParams.append("statuses", s));
      }
      if (params.ignoreNationEventTypes) {
        searchParams.append("ignoreNationEventTypes", "true");
      }
      return apiRequest<{
        eventTypes: EventTypeResponse[];
        totalCount: number;
      }>(`/event-type?${searchParams.toString()}`);
    },

    byOrgId: (input: { orgId: number; isActive?: boolean }) => {
      const searchParams = new URLSearchParams();
      if (input.isActive !== undefined) {
        searchParams.append("isActive", input.isActive.toString());
      }
      const query = searchParams.toString();
      return apiRequest<{ eventTypes: EventTypeResponse[] }>(
        `/event-type/org/${input.orgId}${query ? `?${query}` : ""}`,
      );
    },

    byId: (input: { id: number }) =>
      apiRequest<{ eventType: EventTypeResponse | null }>(
        `/event-type/id/${input.id}`,
      ),

    crupdate: (input: EventTypeInput) =>
      apiRequest<{ eventType: EventTypeResponse | null }>(`/event-type`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    delete: (id: number) =>
      apiRequest<void>(`/event-type/id/${id}`, {
        method: "DELETE",
      }),
  },

  eventTag: {
    all: (params: {
      orgIds?: number[];
      statuses?: ("active" | "inactive")[];
      ignoreNationEventTags?: boolean;
    }) => {
      const searchParams = new URLSearchParams();
      if (params.orgIds) {
        params.orgIds.forEach((id) =>
          searchParams.append("orgIds", id.toString()),
        );
      }
      if (params.statuses) {
        params.statuses.forEach((s) => searchParams.append("statuses", s));
      }
      if (params.ignoreNationEventTags) {
        searchParams.append("ignoreNationEventTags", "true");
      }
      return apiRequest<{
        eventTags: EventTagResponse[];
        totalCount: number;
      }>(`/event-tag?${searchParams.toString()}`);
    },

    byOrgId: (input: { orgId: number; isActive?: boolean }) => {
      const searchParams = new URLSearchParams();
      if (input.isActive !== undefined) {
        searchParams.append("isActive", input.isActive.toString());
      }
      const query = searchParams.toString();
      return apiRequest<{ eventTags: EventTagResponse[] }>(
        `/event-tag/org/${input.orgId}${query ? `?${query}` : ""}`,
      );
    },

    byId: (input: { id: number }) =>
      apiRequest<{ eventTag: EventTagResponse | null }>(
        `/event-tag/id/${input.id}`,
      ),

    crupdate: (input: EventTagInput) =>
      apiRequest<{ eventTag: EventTagResponse | null }>(`/event-tag`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    delete: (id: number) =>
      apiRequest<void>(`/event-tag/id/${id}`, {
        method: "DELETE",
      }),
  },

  /**
   * Series API methods (using event endpoints)
   * Series are events with recurrence patterns
   */
  series: {
    all: (params: {
      regionIds?: number[];
      aoIds?: number[];
      statuses?: ("active" | "inactive")[];
      onlyMine?: boolean;
    }) => {
      const searchParams = new URLSearchParams();
      if (params.regionIds) {
        params.regionIds.forEach((id) =>
          searchParams.append("regionIds", id.toString()),
        );
      }
      if (params.aoIds) {
        params.aoIds.forEach((id) =>
          searchParams.append("aoIds", id.toString()),
        );
      }
      if (params.statuses) {
        params.statuses.forEach((s) => searchParams.append("statuses", s));
      }
      if (params.onlyMine) {
        searchParams.append("onlyMine", "true");
      }
      return apiRequest<{
        events: SeriesResponse[];
        totalCount: number;
      }>(`/event?${searchParams.toString()}`);
    },

    byId: (input: { id: number }) =>
      apiRequest<{ event: SeriesResponse | null }>(`/event/id/${input.id}`),

    crupdate: (input: SeriesInput) =>
      apiRequest<{ event: SeriesResponse | null }>(`/event`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    delete: (id: number) =>
      apiRequest<{ eventId: number }>(`/event/delete/${id}`, {
        method: "DELETE",
      }),
  },
};

export type ApiClient = typeof api;

/**
 * Types for org API responses
 */
interface OrgResponse {
  id: number;
  parentId: number | null;
  name: string;
  orgType: "ao" | "region" | "area" | "sector" | "nation";
  defaultLocationId: number | null;
  description: string | null;
  isActive: boolean;
  logoUrl: string | null;
  website: string | null;
  email: string | null;
  meta: Record<string, string> | null;
}

interface OrgInput {
  id?: number;
  parentId?: number;
  orgType: "ao" | "region" | "area" | "sector" | "nation";
  name: string;
  description?: string | null;
  defaultLocationId?: number | null;
  isActive?: boolean;
  logoUrl?: string | null;
  meta?: Record<string, string>;
}

/**
 * Types for event-type API responses
 */
interface EventTypeResponse {
  id: number;
  name: string;
  description: string | null;
  eventCategory: string;
  acronym: string | null;
  specificOrgId: number | null;
  isActive: boolean;
}

interface EventTypeInput {
  id?: number;
  name: string;
  description?: string | null;
  eventCategory: string;
  acronym?: string | null;
  specificOrgId?: number | null;
  isActive?: boolean;
}

/**
 * Types for event-tag API responses
 */
interface EventTagResponse {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  specificOrgId: number | null;
  isActive: boolean;
}

interface EventTagInput {
  id?: number;
  name: string;
  description?: string | null;
  color?: string | null;
  specificOrgId?: number | null;
  isActive?: boolean;
}

/**
 * Types for series (event) API responses
 */
interface SeriesResponse {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  locationId: number | null;
  startDate: string;
  dayOfWeek: string | null;
  startTime: string | null;
  endTime: string | null;
  email: string | null;
  highlight: boolean;
  recurrencePattern: string | null;
  recurrenceInterval: number | null;
  indexWithinInterval: number | null;
  meta: Record<string, unknown> | null;
  eventTypes?: { eventTypeId: number; eventTypeName: string }[];
}

interface SeriesInput {
  id?: number;
  name?: string;
  description?: string | null;
  isActive?: boolean;
  locationId?: number | null;
  aoId?: number;
  regionId?: number;
  startDate?: string;
  endDate?: string | null;
  dayOfWeek?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  highlight?: boolean;
  recurrencePattern?: string | null;
  recurrenceInterval?: number | null;
  indexWithinInterval?: number | null;
  meta?: Record<string, unknown> | null;
  eventTypeIds?: number[];
  isPrivate?: boolean;
}
