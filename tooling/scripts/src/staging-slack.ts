/**
 * Carry staging's own Slack data across a refresh (F3-65).
 *
 * The obfuscator empties prod's slack_spaces, slack_users and
 * orgs_x_slack_spaces: prod's workspaces are useless on staging, and the
 * staging slackbot acts on whatever it finds there (after the 2026-09-23
 * refresh it regenerated prod regions' calendar images). Staging's own
 * workspace (App Pioneers) still has to keep working, so this stashes
 * staging's rows in a holding schema INSIDE staging before the load and puts
 * them back afterwards. Kept apart from staging-api-keys.ts so the Slack step
 * can be deleted outright once F3 moves off Slack.
 *
 *   --stash    copy the three tables, plus F3versary's delivery runs
 *              (slackbot schema, when present), into refresh_keep_slack.*
 *   --restore  put them back after the load and drop refresh_keep_slack.
 *              An id only means the same thing across a refresh if the row
 *              behind it is the same, so:
 *              - a workspace's org link (and an F3versary run) comes back only
 *                if the loaded copy's org with that id has the same name and
 *                type as when it was stashed; anything else is listed to
 *                relink by hand (or, for a run, dropped with its pages);
 *              - every Slack member comes back unlinked (user_id NULL) and
 *                with the profile shape the staging slackbot writes (sink
 *                email, placeholder name, no avatar, no Strava link or meta). Staging's users can't be
 *                told apart from the loaded copy's (both are sink+<id>), and
 *                a real profile synced before the bot's non-prod privacy
 *                change must not survive. The staging slackbot creates a
 *                fresh synthetic user for each member on their next action;
 *              - F3versary runs come back without their pages, and a run that
 *                was still delivering (`planned`) comes back `abandoned`. The
 *                pages hold the announcement text and blocks, which name
 *                members (real names, if posted before the bot's non-prod
 *                privacy change). The bot only reads a run's pages while it
 *                is `planned`, and skips any day that already has a run that
 *                isn't, so a restored run stops it re-announcing that day and
 *                nothing stashed can be posted afterwards.
 *
 * Usage (staging, around the load):
 *   DATABASE_URL=... pnpm -F @acme/scripts staging-slack -- \
 *     --allow-db <staging-db-name> --stash
 *   ... truncate + load ...
 *   DATABASE_URL=... pnpm -F @acme/scripts staging-slack -- \
 *     --allow-db <staging-db-name> --restore [--email-sink <group@domain>]
 */
import type postgres from "postgres";

import { connectToStaging, flagValue, stashOrRestore } from "./staging-target";

const argv = process.argv.slice(2);

// Same default as the obfuscator's --email-sink.
const EMAIL_SINK = (
  flagValue(argv, "--email-sink") ?? "dev.staging-email-sink@f3nation.com"
).toLowerCase();
const [SINK_LOCAL, SINK_DOMAIN] = EMAIL_SINK.split("@") as [string, string];

const TABLES = ["slack_spaces", "slack_users", "orgs_x_slack_spaces"] as const;

// F3versary's delivery state (migration 0028). Its runs reference
// slack_spaces and orgs, so staging's rows have to come out with the Slack
// tables and go back after them; carrying the runs across keeps the staging
// slackbot from re-announcing a day it already handled
// (apps/slackbot/scripts/f3versary_announcements.py: a day with a run that
// isn't `planned` is skipped). Only the runs are carried: pages are never
// stashed or restored (see the header).
const F3VERSARY_TABLES = [
  "f3versary_delivery_runs",
  "f3versary_delivery_pages",
] as const;

/** Whether F3versary's slackbot-schema tables exist (migration 0028+). */
async function hasF3versary(
  tx: postgres.Sql | postgres.TransactionSql,
): Promise<boolean> {
  const [row] = await tx<{ present: boolean }[]>`
    SELECT to_regclass('slackbot.f3versary_delivery_runs') IS NOT NULL
      AS present`;
  return row?.present === true;
}

async function main(): Promise<void> {
  const mode = stashOrRestore(argv);
  const sql = await connectToStaging(argv);
  try {
    if (mode === "stash") {
      await sql.begin(async (tx) => {
        const [existing] = await tx<{ present: boolean }[]>`
          SELECT to_regnamespace('refresh_keep_slack') IS NOT NULL AS present`;
        if (existing?.present) {
          throw new Error(
            "refresh_keep_slack already exists: a previous stash was never restored. Restore it (or drop refresh_keep_slack) first.",
          );
        }
        await tx`CREATE SCHEMA refresh_keep_slack`;
        for (const table of TABLES) {
          await tx.unsafe(
            `CREATE TABLE refresh_keep_slack.${table} AS TABLE public.${table}`,
          );
        }
        const f3versary = await hasF3versary(tx);
        if (f3versary) {
          await tx.unsafe(
            `CREATE TABLE refresh_keep_slack.f3versary_delivery_runs AS TABLE slackbot.f3versary_delivery_runs`,
          );
        }
        // What each linked org IS, so the restore can tell whether the
        // loaded copy's org with the same id is still the same org.
        await tx.unsafe(`
          CREATE TABLE refresh_keep_slack.orgs AS
          SELECT id, name, org_type::text AS org_type FROM public.orgs
          WHERE id IN (SELECT org_id FROM public.orgs_x_slack_spaces)
          ${f3versary ? "OR id IN (SELECT org_id FROM slackbot.f3versary_delivery_runs)" : ""}`);
      });
      const [n] = await sql<{ spaces: number; users: number; links: number }[]>`
        SELECT (SELECT count(*)::int FROM refresh_keep_slack.slack_spaces) AS spaces,
          (SELECT count(*)::int FROM refresh_keep_slack.slack_users) AS users,
          (SELECT count(*)::int FROM refresh_keep_slack.orgs_x_slack_spaces) AS links`;
      console.log(
        `Stashed ${n?.spaces} workspace(s), ${n?.users} Slack member(s) and ${n?.links} org link(s) in refresh_keep_slack.`,
      );
      return;
    }

    await sql.begin(async (tx) => {
      const [stashed] = await tx<{ present: boolean }[]>`
        SELECT to_regclass('refresh_keep_slack.slack_spaces') IS NOT NULL AS present`;
      if (!stashed?.present) {
        throw new Error("Nothing to restore: refresh_keep_slack is missing.");
      }
      const f3versary =
        (await hasF3versary(tx)) &&
        (
          await tx<{ present: boolean }[]>`
          SELECT to_regclass('refresh_keep_slack.f3versary_delivery_runs')
            IS NOT NULL AS present`
        )[0]?.present === true;
      const [loaded] = await tx<{ n: number }[]>`
        SELECT (SELECT count(*) FROM public.slack_spaces)
          + (SELECT count(*) FROM public.slack_users)
          + (SELECT count(*) FROM public.orgs_x_slack_spaces) AS n`;
      const [loadedF3versary] = f3versary
        ? await tx<{ n: number }[]>`
            SELECT (SELECT count(*) FROM slackbot.f3versary_delivery_runs)
              + (SELECT count(*) FROM slackbot.f3versary_delivery_pages) AS n`
        : [{ n: 0 }];
      if (Number(loadedF3versary?.n) > 0) {
        throw new Error(
          "The slackbot F3versary tables aren't empty: empty them with the Slack tables during the load, or this restore already ran.",
        );
      }
      if (Number(loaded?.n) > 0) {
        throw new Error(
          "The Slack tables aren't empty: the load carried Slack rows (an obfuscated copy from before this change?) or this restore already ran. Empty them first.",
        );
      }

      // An org id is trusted only if the loaded org behind it is the one
      // that was stashed.
      const sameOrg = (alias: string) => `EXISTS (
        SELECT 1 FROM public.orgs o
        JOIN refresh_keep_slack.orgs k ON k.id = o.id
        WHERE o.id = ${alias}.org_id AND o.name = k.name
          AND o.org_type::text = k.org_type)`;
      const spaces = await tx`
        INSERT INTO public.slack_spaces SELECT * FROM refresh_keep_slack.slack_spaces
        RETURNING id`;
      // Count only; never print the values.
      const [unsunk] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM refresh_keep_slack.slack_users
        WHERE NOT (lower(email) LIKE ${`${SINK_LOCAL}+%@${SINK_DOMAIN}`})`;
      await tx`
        UPDATE refresh_keep_slack.slack_users
        SET user_id = NULL,
          email = ${`${SINK_LOCAL}+slack-`}::text || id::text
            || ${`@${SINK_DOMAIN}`}::text,
          user_name = 'F3 pending',
          avatar_url = NULL,
          -- Staging members may have linked a real Strava account, and meta is
          -- free-form profile JSON: neither may outlive the refresh.
          strava_access_token = NULL,
          strava_refresh_token = NULL,
          strava_expires_at = NULL,
          strava_athlete_id = NULL,
          meta = NULL`;
      const users = await tx`
        INSERT INTO public.slack_users SELECT * FROM refresh_keep_slack.slack_users
        RETURNING id`;
      const links = await tx.unsafe(`
        INSERT INTO public.orgs_x_slack_spaces (org_id, slack_space_id)
        SELECT l.org_id, l.slack_space_id FROM refresh_keep_slack.orgs_x_slack_spaces l
        WHERE ${sameOrg("l")}
        RETURNING org_id`);
      const missingOrgs = await tx.unsafe<
        { org_id: number; team_id: string; was: string; now: string | null }[]
      >(`
        SELECT l.org_id, s.team_id, k.name AS was, o.name AS now
        FROM refresh_keep_slack.orgs_x_slack_spaces l
        JOIN refresh_keep_slack.slack_spaces s ON s.id = l.slack_space_id
        LEFT JOIN refresh_keep_slack.orgs k ON k.id = l.org_id
        LEFT JOIN public.orgs o ON o.id = l.org_id
        WHERE NOT ${sameOrg("l")}`);
      for (const table of ["slack_spaces", "slack_users"]) {
        await tx`
          SELECT setval(pg_get_serial_sequence(${`public.${table}`}, 'id'),
            GREATEST((SELECT max(id) FROM ${tx(`public.${table}`)}), 1))`;
      }

      let runs = 0;
      let abandoned = 0;
      let droppedRuns = 0;
      if (f3versary) {
        const restoredRuns = await tx.unsafe(`
          INSERT INTO slackbot.f3versary_delivery_runs
          SELECT * FROM refresh_keep_slack.f3versary_delivery_runs r
          WHERE ${sameOrg("r")}
          RETURNING id`);
        // A run still delivering would resume posting its pages; it has none
        // now, and `abandoned` is what the bot itself does with an unfinished
        // run once its day has passed (_abandon_old_runs).
        const abandonedRuns = await tx`
          UPDATE slackbot.f3versary_delivery_runs SET status = 'abandoned'
          WHERE status = 'planned'
          RETURNING id`;
        const [stashedRuns] = await tx<{ n: number }[]>`
          SELECT count(*)::int AS n
          FROM refresh_keep_slack.f3versary_delivery_runs`;
        runs = restoredRuns.length;
        abandoned = abandonedRuns.length;
        droppedRuns = (stashedRuns?.n ?? 0) - runs;
        for (const table of F3VERSARY_TABLES) {
          await tx`
            SELECT setval(pg_get_serial_sequence(${`slackbot.${table}`}, 'id'),
              GREATEST((SELECT max(id) FROM ${tx(`slackbot.${table}`)}), 1))`;
        }
      }
      await tx`DROP SCHEMA refresh_keep_slack CASCADE`;

      console.log(
        `Restored ${spaces.length} workspace(s), ${users.length} Slack member(s) and ${links.length} org link(s).`,
      );
      if (f3versary) {
        console.log(
          `Restored ${runs} F3versary run(s) without their pages (announcement text is never restored).` +
            (abandoned > 0
              ? ` Marked ${abandoned} unfinished run(s) abandoned, so none resumes posting.`
              : "") +
            (droppedRuns > 0
              ? ` Dropped ${droppedRuns} run(s) whose org isn't the same org in the loaded copy.`
              : ""),
        );
      }
      console.log(
        `All ${users.length} member(s) restored unlinked with placeholder profiles; the staging slackbot re-creates each one's synthetic user on their next action. Restart it so it drops its cached links.`,
      );
      if ((unsunk?.n ?? 0) > 0) {
        console.log(
          `Scrubbed ${unsunk?.n} member profile(s) that had an email outside ${EMAIL_SINK} (real profiles synced before the slackbot's non-prod privacy change).`,
        );
      }
      if (missingOrgs.length > 0) {
        console.log(
          `Not relinked (the loaded copy's org with that id is missing or a different org), relink by hand:\n` +
            missingOrgs
              .map(
                (m) =>
                  `  workspace ${m.team_id} -> org ${m.org_id} (was "${m.was ?? "?"}", now ${m.now === null ? "missing" : `"${m.now}"`})`,
              )
              .join("\n"),
        );
      }
    });
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
