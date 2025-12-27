/**
 * oRPC API Client
 *
 * Creates a typed client for the F3 Nation API.
 * Used for all database operations instead of direct DB access.
 */

import { logger } from "./logger";

// API base URL - defaults to local development
const API_BASE_URL = process.env.API_URL ?? "http://localhost:3000/api/v1";

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
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(
        `API request failed: ${response.status} ${response.statusText}`,
      );
    }

    return (await response.json()) as T;
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
      apiRequest<{
        id: number;
        teamId: string;
        workspaceName: string | null;
        botToken: string | null;
        settings: Record<string, unknown> | null;
      } | null>(`/slack/space?teamId=${encodeURIComponent(teamId)}`),
  },
};

export type ApiClient = typeof api;
