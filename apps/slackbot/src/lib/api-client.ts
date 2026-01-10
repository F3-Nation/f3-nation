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
        ...(API_KEY ? { "x-api-key": API_KEY } : {}),
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
};

export type ApiClient = typeof api;
