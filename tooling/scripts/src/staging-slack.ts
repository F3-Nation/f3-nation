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
 *   --stash    copy the three tables into refresh_keep_slack.*
 *   --restore  put them back after the load and drop refresh_keep_slack.
 *              org ids and user ids carry over from prod, so staging's links
 *              usually still resolve. A workspace linked to an org the loaded
 *              copy doesn't have is restored unlinked (relink it by hand), and
 *              a Slack member whose user_id is gone is restored with
 *              user_id NULL (the slackbot re-links it).
 *
 * Usage (staging, around the load):
 *   DATABASE_URL=... pnpm -F @acme/scripts staging-slack -- \
 *     --allow-db <staging-db-name> --stash
 *   ... truncate + load ...
 *   DATABASE_URL=... pnpm -F @acme/scripts staging-slack -- \
 *     --allow-db <staging-db-name> --restore [--email-sink <group@domain>]
 */
import { connectToStaging, flagValue, stashOrRestore } from "./staging-target";

const argv = process.argv.slice(2);

// Same default as the obfuscator's --email-sink.
const EMAIL_SINK = (
  flagValue(argv, "--email-sink") ?? "dev.staging-email-sink@f3nation.com"
).toLowerCase();
const [SINK_LOCAL, SINK_DOMAIN] = EMAIL_SINK.split("@") as [string, string];

const TABLES = ["slack_spaces", "slack_users", "orgs_x_slack_spaces"] as const;

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
      const [loaded] = await tx<{ n: number }[]>`
        SELECT (SELECT count(*) FROM public.slack_spaces)
          + (SELECT count(*) FROM public.slack_users)
          + (SELECT count(*) FROM public.orgs_x_slack_spaces) AS n`;
      if (Number(loaded?.n) > 0) {
        throw new Error(
          "The Slack tables aren't empty: the load carried Slack rows (an obfuscated copy from before this change?) or this restore already ran. Empty them first.",
        );
      }

      const unlinkedUsers = await tx<{ id: number }[]>`
        UPDATE refresh_keep_slack.slack_users s SET user_id = NULL
        WHERE s.user_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = s.user_id)
        RETURNING s.id`;
      const spaces = await tx`
        INSERT INTO public.slack_spaces SELECT * FROM refresh_keep_slack.slack_spaces
        RETURNING id`;
      const users = await tx`
        INSERT INTO public.slack_users SELECT * FROM refresh_keep_slack.slack_users
        RETURNING id`;
      const links = await tx`
        INSERT INTO public.orgs_x_slack_spaces (org_id, slack_space_id)
        SELECT l.org_id, l.slack_space_id FROM refresh_keep_slack.orgs_x_slack_spaces l
        WHERE EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = l.org_id)
        RETURNING org_id`;
      const missingOrgs = await tx<{ org_id: number; team_id: string }[]>`
        SELECT l.org_id, s.team_id
        FROM refresh_keep_slack.orgs_x_slack_spaces l
        JOIN refresh_keep_slack.slack_spaces s ON s.id = l.slack_space_id
        WHERE NOT EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = l.org_id)`;
      for (const table of ["slack_spaces", "slack_users"]) {
        await tx`
          SELECT setval(pg_get_serial_sequence(${`public.${table}`}, 'id'),
            GREATEST((SELECT max(id) FROM ${tx(`public.${table}`)}), 1))`;
      }
      // The staging slackbot syncs member profiles as Slack reports them,
      // so what comes back is whatever it wrote since the last refresh.
      // Count only; never print the values.
      const [unsunk] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM public.slack_users
        WHERE NOT (lower(email) LIKE ${`${SINK_LOCAL}+%@${SINK_DOMAIN}`})`;
      await tx`DROP SCHEMA refresh_keep_slack CASCADE`;

      console.log(
        `Restored ${spaces.length} workspace(s), ${users.length} Slack member(s) and ${links.length} org link(s).`,
      );
      if (unlinkedUsers.length > 0) {
        console.log(
          `${unlinkedUsers.length} Slack member(s) pointed at a user the loaded copy doesn't have; restored with user_id NULL.`,
        );
      }
      if (missingOrgs.length > 0) {
        console.log(
          `Not relinked (org missing from the loaded copy), relink by hand:\n` +
            missingOrgs
              .map((m) => `  workspace ${m.team_id} -> org ${m.org_id}`)
              .join("\n"),
        );
      }
      if ((unsunk?.n ?? 0) > 0) {
        console.log(
          `Warning: ${unsunk?.n} restored Slack member(s) have an email outside ${EMAIL_SINK}, likely real profiles the staging slackbot synced.`,
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
