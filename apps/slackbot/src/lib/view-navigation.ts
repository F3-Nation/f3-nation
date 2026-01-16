import type { AnyMiddlewareArgs } from "@slack/bolt";
import type { ModalView } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import { ACTIONS } from "../constants/actions";
import type { NavigationMetadata } from "../types/bolt-types";
import { parseNavMetadata, stringifyNavMetadata } from "../types/bolt-types";

export interface NavigationContext {
  client: WebClient;
  triggerId: string;
  currentViewId?: string;
  teamId: string;
  _currentDepth: number;
  metadata: NavigationMetadata;
}

export interface NavigateOptions {
  /** Show loading spinner before fetching data */
  showLoading?: boolean;
  /** Title for loading screen */
  loadingTitle?: string;
  /** Force update instead of push (when at depth limit) */
  forceUpdate?: boolean;
}

/**
 * Creates a navigation context from a Bolt action/view payload
 */
export function createNavContext(args: {
  client: WebClient;
  body: AnyMiddlewareArgs["body"];
  context: { teamId?: string };
}): NavigationContext {
  const { client, body, context } = args;

  // View payloads have view on the body, action payloads might have it too (e.g. block_actions)
  // Use unknown + type check to avoiding 'any'
  const bodyWithView = body as {
    view?: { id: string; private_metadata?: string };
  };
  const view = bodyWithView.view;

  const bodyWithTrigger = body as { trigger_id?: string };
  const triggerId = bodyWithTrigger.trigger_id;

  const metadata = parseNavMetadata(view?.private_metadata);

  return {
    client,
    triggerId: triggerId ?? "",
    currentViewId: view?.id,
    teamId: context.teamId ?? "",
    _currentDepth: metadata._navDepth,
    metadata,
  };
}

/**
 * Pushes a new modal if stack allows, otherwise updates current view.
 * Handles loading states to prevent trigger_id expiration.
 */
export async function navigateToView(
  ctx: NavigationContext,
  buildView: (metadata: NavigationMetadata) => Promise<ModalView> | ModalView,
  options: NavigateOptions = {},
): Promise<string> {
  const {
    showLoading = false,
    loadingTitle = "Loading...",
    forceUpdate = false,
  } = options;

  const currentDepth = ctx._currentDepth;
  const shouldUpdate = forceUpdate || currentDepth >= 2;

  let targetViewId = ctx.currentViewId;

  if (showLoading) {
    const loadingMetadata: NavigationMetadata = {
      _navDepth: currentDepth, // Loading screen doesn't increase depth
      _isLoading: true,
    };
    const loadingView = buildLoadingModal(loadingTitle, loadingMetadata);

    if (shouldUpdate && ctx.currentViewId) {
      await ctx.client.views.update({
        view_id: ctx.currentViewId,
        view: loadingView,
      });
    } else {
      const result = await ctx.client.views.push({
        trigger_id: ctx.triggerId,
        view: loadingView,
      });
      targetViewId = result.view?.id;
    }
  }

  // Build the real view, providing it with the next metadata
  const nextMetadata: NavigationMetadata = {
    _navDepth: shouldUpdate ? currentDepth : currentDepth + 1,
  };

  const finalView = await buildView(nextMetadata);

  // Merge metadata
  const existingMetadata = parseNavMetadata(finalView.private_metadata);
  finalView.private_metadata = stringifyNavMetadata({
    ...existingMetadata,
    ...nextMetadata,
  });

  // Update or push the final content
  if (targetViewId) {
    await ctx.client.views.update({
      view_id: targetViewId,
      view: finalView,
    });
    return targetViewId;
  } else {
    const result = await ctx.client.views.push({
      trigger_id: ctx.triggerId,
      view: finalView,
    });
    return result.view?.id ?? "";
  }
}

/**
 * Build a standard loading modal
 */
export function buildLoadingModal(
  title: string,
  metadata?: NavigationMetadata,
): ModalView {
  return {
    type: "modal",
    callback_id: ACTIONS.NAV_LOADING,
    title: { type: "plain_text", text: title },
    private_metadata: metadata ? stringifyNavMetadata(metadata) : undefined,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: ":hourglass_flowing_sand: Loading, please wait...",
        },
      },
    ],
  };
}
