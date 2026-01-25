import type {
  OrgResponse as ApiOrgResponse,
  RegionResponse,
  SlackSpaceResponse,
  SlackUserData,
  SlackUserResponse,
  SuccessActionResponse,
  UpdateSpaceSettingsInput,
  UpsertUserInput,
  GetOrCreateSpaceInput,
  GetOrCreateUserInput,
  GetOrCreateLinkedUserInput,
  LinkedSlackUserResponse,
  LocationListResponse,
  LocationResponse,
  LocationInput,
  EventInstanceResponse,
  EventInstanceListResponse,
  EventInstanceInput,
  CheckUserRoleResponse,
  GetUserRolesResponse,
  UpcomingQsResponse,
  PastQsResponse,
  EventsWithoutQResponse,
} from "../types/api-types";
import { logger } from "./logger";

// API base URL - defaults to local development
const API_BASE_URL = process.env.API_URL ?? "http://localhost:3000/v1";
const API_KEY = process.env.SLACKBOT_API_KEY;

// Cache TTL configuration (in milliseconds)
const CACHE_TTL = {
  space: 5 * 60 * 1000, // 5 minutes for space settings
  org: 5 * 60 * 1000, // 5 minutes for org info
  user: 2 * 60 * 1000, // 2 minutes for user data
  roles: 2 * 60 * 1000, // 2 minutes for role data
} as const;

/**
 * Simple in-memory cache with TTL support.
 * Can be replaced with Redis or another cache backend later.
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class SimpleCache {
  private cache = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Delete all entries matching a prefix (e.g., invalidate all user caches for a team)
   */
  deleteByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }
}

// Singleton cache instance
const cache = new SimpleCache();

/**
 * Export cache for use in tests or manual invalidation
 */
export { cache };

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
    /**
     * Get Slack space settings for a team.
     * Results are cached for 5 minutes.
     */
    getSpace: async (teamId: string): Promise<SlackSpaceResponse | null> => {
      const cacheKey = `space:${teamId}`;
      const cached = cache.get<SlackSpaceResponse | null>(cacheKey);
      if (cached !== null) {
        logger.debug(`Cache hit for space: ${teamId}`);
        return cached;
      }

      const result = await apiRequest<SlackSpaceResponse | null>(
        `/slack/space?teamId=${encodeURIComponent(teamId)}`,
      );
      cache.set(cacheKey, result, CACHE_TTL.space);
      return result;
    },

    updateSpaceSettings: async (
      teamId: string,
      settings: UpdateSpaceSettingsInput,
    ) => {
      const result = await apiRequest<{ success: boolean }>(
        `/slack/space/settings`,
        {
          method: "PATCH",
          body: JSON.stringify({ teamId, settings }),
        },
      );
      // Invalidate cache after update
      cache.delete(`space:${teamId}`);
      return result;
    },

    /**
     * Get user by Slack ID (not cached - use getOrCreateLinkedUser for middleware)
     */
    getUserBySlackId: (slackId: string, teamId: string) =>
      apiRequest<SlackUserResponse | null>(
        `/slack/user?slackId=${encodeURIComponent(slackId)}&teamId=${encodeURIComponent(teamId)}`,
      ),

    getOrCreateSpace: async (
      input: GetOrCreateSpaceInput,
    ): Promise<SlackSpaceResponse> => {
      const result = await apiRequest<SlackSpaceResponse>(
        `/slack/get-or-create-space`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      // Cache the newly created/fetched space
      cache.set(`space:${input.teamId}`, result, CACHE_TTL.space);
      return result;
    },

    /**
     * @deprecated Use getOrCreateLinkedUser instead to ensure F3 user is linked
     */
    getOrCreateUser: (input: GetOrCreateUserInput) =>
      apiRequest<SlackUserData>(`/slack/get-or-create-user`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    /**
     * Get or create a Slack user with a guaranteed linked F3 user.
     * This is the preferred method for middleware - ensures every Slack user
     * has a corresponding F3 user ID.
     * Results are cached for 2 minutes.
     */
    getOrCreateLinkedUser: async (
      input: GetOrCreateLinkedUserInput,
    ): Promise<LinkedSlackUserResponse> => {
      const cacheKey = `user:${input.teamId}:${input.slackId}`;
      const cached = cache.get<LinkedSlackUserResponse>(cacheKey);
      if (cached !== null) {
        logger.debug(`Cache hit for user: ${input.slackId}`);
        return cached;
      }

      const result = await apiRequest<LinkedSlackUserResponse>(
        `/slack/get-or-create-linked-user`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      cache.set(cacheKey, result, CACHE_TTL.user);
      return result;
    },

    upsertUser: async (input: UpsertUserInput) => {
      const result = await apiRequest<SuccessActionResponse>(
        `_action/slack/user`,
        {
          method: "PUT",
          body: JSON.stringify(input),
        },
      );
      // Invalidate user cache after upsert
      cache.deleteByPrefix(`user:${input.teamId}:${input.slackId}`);
      cache.deleteByPrefix(`roles:${input.teamId}:${input.slackId}`);
      return result;
    },

    /**
     * Get the org associated with a Slack workspace.
     * Results are cached for 5 minutes.
     */
    getOrg: async (teamId: string): Promise<ApiOrgResponse | null> => {
      const cacheKey = `org:${teamId}`;
      const cached = cache.get<ApiOrgResponse | null>(cacheKey);
      if (cached !== null) {
        logger.debug(`Cache hit for org: ${teamId}`);
        return cached;
      }

      const result = await apiRequest<ApiOrgResponse | null>(
        `/slack/org?teamId=${encodeURIComponent(teamId)}`,
      );
      cache.set(cacheKey, result, CACHE_TTL.org);
      return result;
    },

    /**
     * @deprecated Use getOrg instead
     */
    getRegion: (teamId: string) =>
      apiRequest<RegionResponse | null>(
        `/slack/region?teamId=${encodeURIComponent(teamId)}`,
      ),

    /**
     * Check if a Slack user has a specific F3 role on the org.
     * Uses the F3 role system, not Slack's admin/owner flags.
     */
    checkUserRole: (
      slackId: string,
      teamId: string,
      roleName: "user" | "editor" | "admin" = "admin",
    ) =>
      apiRequest<CheckUserRoleResponse>(
        `/slack/check-role?slackId=${encodeURIComponent(slackId)}&teamId=${encodeURIComponent(teamId)}&roleName=${encodeURIComponent(roleName)}`,
      ),

    /**
     * Get all F3 roles for a Slack user on the org and its ancestors.
     * Returns role information and computed isAdmin/isEditor flags.
     * Results are cached for 2 minutes.
     */
    getUserRoles: async (
      slackId: string,
      teamId: string,
    ): Promise<GetUserRolesResponse> => {
      const cacheKey = `roles:${teamId}:${slackId}`;
      const cached = cache.get<GetUserRolesResponse>(cacheKey);
      if (cached !== null) {
        logger.debug(`Cache hit for roles: ${slackId}`);
        return cached;
      }

      const result = await apiRequest<GetUserRolesResponse>(
        `/slack/user-roles?slackId=${encodeURIComponent(slackId)}&teamId=${encodeURIComponent(teamId)}`,
      );
      cache.set(cacheKey, result, CACHE_TTL.roles);
      return result;
    },

    /**
     * Invalidate all caches for a specific team.
     * Useful when settings or roles change.
     */
    invalidateTeamCache: (teamId: string) => {
      cache.delete(`space:${teamId}`);
      cache.delete(`org:${teamId}`);
      cache.deleteByPrefix(`user:${teamId}:`);
      cache.deleteByPrefix(`roles:${teamId}:`);
      logger.debug(`Invalidated all caches for team: ${teamId}`);
    },

    /**
     * Invalidate user-specific caches.
     * Useful when a user's roles or profile changes.
     */
    invalidateUserCache: (teamId: string, slackId: string) => {
      cache.delete(`user:${teamId}:${slackId}`);
      cache.delete(`roles:${teamId}:${slackId}`);
      logger.debug(`Invalidated caches for user: ${slackId}`);
    },

    /**
     * Connect a Slack workspace to an F3 org.
     * Either links to an existing org (by orgId) or creates a new one (by newOrgName).
     */
    connectSpaceToOrg: async (input: {
      teamId: string;
      orgId?: number;
      newOrgName?: string;
      orgType?: "ao" | "region" | "area" | "sector" | "nation";
    }): Promise<{ success: boolean; orgId: number }> => {
      const result = await apiRequest<{ success: boolean; orgId: number }>(
        `/slack/connect-space-to-org`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      // Invalidate both space and org caches after connecting
      cache.delete(`space:${input.teamId}`);
      cache.delete(`org:${input.teamId}`);
      return result;
    },

    /**
     * Assign a role to a user for a specific org.
     */
    assignUserRole: async (input: {
      userId: number;
      orgId: number;
      roleName: "user" | "editor" | "admin";
    }): Promise<{ success: boolean; alreadyHadRole: boolean }> => {
      return apiRequest<{ success: boolean; alreadyHadRole: boolean }>(
        `/slack/assign-user-role`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },
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

  eventInstance: {
    all: (params: {
      regionOrgId?: number;
      aoOrgId?: number;
      startDate?: string;
      statuses?: ("active" | "inactive")[];
      searchTerm?: string;
      pageIndex?: number;
      pageSize?: number;
    }) => {
      const searchParams = new URLSearchParams();
      if (params.regionOrgId)
        searchParams.append("regionOrgId", params.regionOrgId.toString());
      if (params.aoOrgId)
        searchParams.append("aoOrgId", params.aoOrgId.toString());
      if (params.startDate) searchParams.append("startDate", params.startDate);
      if (params.searchTerm)
        searchParams.append("searchTerm", params.searchTerm);
      if (params.statuses) {
        params.statuses.forEach((s) => searchParams.append("statuses", s));
      }
      if (params.pageIndex !== undefined)
        searchParams.append("pageIndex", params.pageIndex.toString());
      if (params.pageSize !== undefined)
        searchParams.append("pageSize", params.pageSize.toString());
      return apiRequest<EventInstanceListResponse>(
        `/event-instance?${searchParams.toString()}`,
      );
    },

    byId: (input: { id: number }) =>
      apiRequest<EventInstanceResponse | null>(
        `/event-instance/id/${input.id}`,
      ),

    crupdate: (input: EventInstanceInput) =>
      apiRequest<EventInstanceResponse>(`/event-instance`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    delete: (input: { id: number }) =>
      apiRequest<{ success: boolean }>(`/event-instance/id/${input.id}`, {
        method: "DELETE",
      }),

    /**
     * Get upcoming events where the user is Q or Co-Q.
     * Used for preblast selection menu.
     */
    getUpcomingQs: (params: {
      userId: number;
      regionOrgId: number;
      /** Only return events without a posted preblast. Defaults to true. */
      notPostedOnly?: boolean;
    }) => {
      const searchParams = new URLSearchParams();
      searchParams.append("userId", params.userId.toString());
      searchParams.append("regionOrgId", params.regionOrgId.toString());
      if (params.notPostedOnly !== undefined) {
        searchParams.append("notPostedOnly", params.notPostedOnly.toString());
      }
      return apiRequest<UpcomingQsResponse>(
        `/event-instance/upcoming-qs?${searchParams.toString()}`,
      );
    },

    /**
     * Get past events where the user is Q or Co-Q.
     * Used for backblast selection menu.
     */
    getPastQs: (params: {
      userId: number;
      regionOrgId: number;
      /** Only return events without a posted backblast. Defaults to true. */
      notPostedOnly?: boolean;
    }) => {
      const searchParams = new URLSearchParams();
      searchParams.append("userId", params.userId.toString());
      searchParams.append("regionOrgId", params.regionOrgId.toString());
      if (params.notPostedOnly !== undefined) {
        searchParams.append("notPostedOnly", params.notPostedOnly.toString());
      }
      return apiRequest<PastQsResponse>(
        `/event-instance/past-qs?${searchParams.toString()}`,
      );
    },

    /**
     * Get past events without any Q or Co-Q assigned.
     * Used for backblast selection menu "unclaimed events" section.
     */
    getEventsWithoutQ: (params: {
      regionOrgId: number;
      /** Only return events without a posted backblast. Defaults to true. */
      notPostedOnly?: boolean;
      /** Maximum number of events to return. Defaults to 20. */
      limit?: number;
    }) => {
      const searchParams = new URLSearchParams();
      searchParams.append("regionOrgId", params.regionOrgId.toString());
      if (params.notPostedOnly !== undefined) {
        searchParams.append("notPostedOnly", params.notPostedOnly.toString());
      }
      if (params.limit !== undefined) {
        searchParams.append("limit", params.limit.toString());
      }
      return apiRequest<EventsWithoutQResponse>(
        `/event-instance/without-q?${searchParams.toString()}`,
      );
    },
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
  isPrivate: boolean;
  aos?: { aoId: number; aoName: string }[];
  eventTypes?: { eventTypeId: number; eventTypeName: string }[];
  eventTags?: { eventTagId: number; eventTagName: string }[];
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
  eventTagIds?: number[];
  isPrivate?: boolean;
}
