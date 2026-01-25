/**
 * F3 Nation Slack Bot
 *
 * Entry point for the Slack Bolt application.
 * Supports both Socket Mode (local dev) and HTTP mode (production).
 */

import { App, LogLevel } from "@slack/bolt";

import { registerBackblastFeature } from "./features/backblast";
import { registerHelpFeature } from "./features/help";
import { registerWelcomeFeature } from "./features/welcome";
import { registerConfigFeature } from "./features/config";
import { registerCalendarFeature } from "./features/calendar";
import { registerPreblastFeature } from "./features/preblast";
import { withRegionContext } from "./lib/middleware";
import { logger } from "./lib/logger";

// Environment configuration
const isLocalDevelopment =
  process.env.LOCAL_DEVELOPMENT?.toLowerCase() === "true";
const useSocketMode = process.env.SOCKET_MODE?.toLowerCase() === "true";

// Initialize Slack Bolt app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: useSocketMode,
  appToken: useSocketMode ? process.env.SLACK_APP_TOKEN : undefined,
  logLevel: isLocalDevelopment ? LogLevel.DEBUG : LogLevel.INFO,
});

// Global middleware
app.use(withRegionContext);

// Register features
registerHelpFeature(app);
registerWelcomeFeature(app);
registerConfigFeature(app);
registerCalendarFeature(app);
registerPreblastFeature(app);
registerBackblastFeature(app);

// Health check endpoint for HTTP mode
// eslint-disable-next-line @typescript-eslint/require-await
app.event("app_home_opened", async ({ event, client: _client }) => {
  logger.info(`App home opened by user ${event.user}`);
});

// Start the app
async function start() {
  const port = isLocalDevelopment ? 3001 : 8080;

  try {
    await app.start(port);
    logger.info(`⚡️ Slack bot is running!`);
    logger.info(`Mode: ${useSocketMode ? "Socket" : "HTTP"}`);
    if (!useSocketMode) {
      logger.info(`Port: ${port}`);
    }
  } catch (error) {
    logger.error("Failed to start app:", error);
    process.exit(1);
  }
}

void start();

export { app };
