import { isDevModeChannel } from "@acme/shared/common/dev-mode";

import type { RuntimeConfigStatus } from "~/utils/runtime-config";

/**
 * Whether the Settings modal offers "Sign in (Dev Mode)": exactly where the
 * server registers the dev-mode provider, using the same channel list
 * (`@acme/shared/common/dev-mode`). The channel is the runtime one from
 * /api/runtime-config, not the build-time NEXT_PUBLIC_CHANNEL, which images
 * don't receive at build. Hidden until that config has loaded, because its
 * loading default is "local".
 */
export function shouldShowDevModeSignIn({
  channel,
  status,
}: {
  channel: string;
  status: RuntimeConfigStatus;
}): boolean {
  return status === "ready" && isDevModeChannel(channel);
}
