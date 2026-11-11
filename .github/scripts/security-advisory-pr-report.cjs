"use strict";

/**
 * Security Advisory PR Report: the Codeowners PR Report (same lists, lights
 * and wording, from codeowners-pr-report.cjs) for the fix PRs in
 * F3-Nation/f3-nation's open security advisories.
 *
 * Those PRs live in each advisory's temporary private fork, which GitHub keeps
 * from every integration, workflow tokens included. So this runs on a
 * codeowner's machine with their own gh login, through the
 * security-advisory-pr-report agent skill, which posts the message to the
 * private #codeowners Slack channel as that person.
 *
 *   node .github/scripts/security-advisory-pr-report.cjs --check   # access checks only
 *   node .github/scripts/security-advisory-pr-report.cjs           # checks, then the message
 *
 * Read-only, and writes no files. Prints the Slack message (Markdown) on
 * stdout. Exits 1 with the reasons on stderr when a check fails or any
 * advisory fork can't be read: a partial list would read as "nothing waiting".
 */

const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");
const {
  assembleReport,
  toSlackMarkdown,
} = require("./codeowners-pr-report.cjs");

const REPO = { owner: "F3-Nation", repo: "f3-nation" };
// Open advisories; published and closed ones have nothing left to merge.
const ADVISORY_STATES = ["triage", "draft"];
const FORK_NAME = new RegExp(
  `^${REPO.owner}/${REPO.repo}-ghsa(-[a-z0-9]{4}){3}$`,
);
// Slack's Markdown input takes at most this many characters per message.
const SLACK_MAX_CHARS = 5000;
const SKILL = "security-advisory-pr-report";

const TOOLS = [
  [
    "gh",
    "Install the GitHub CLI from https://cli.github.com, then run `gh auth login`.",
  ],
  [
    "jq",
    "Install it with `brew install jq` (macOS) or `sudo apt-get install jq` (Linux/WSL).",
  ],
];

const installed = (tool) =>
  !spawnSync(tool, ["--version"], { stdio: "ignore" }).error;
const ghSignedIn = () =>
  spawnSync("gh", ["auth", "status"], { stdio: "ignore" }).status === 0;

/**
 * Whether the person running this can see every open advisory. Advisory
 * collaborators see only their own, so their report would silently leave PRs
 * out; only org owners, security managers and repository admins pass.
 * `has(tool)` and `signedIn()` are injectable for tests. Returns
 * `{ failures, login, role }`; GitHub isn't called until the tools pass.
 */
async function checkAccess({ github, has = installed, signedIn = ghSignedIn }) {
  const failures = TOOLS.filter(([tool]) => !has(tool)).map(
    ([tool, fix]) => `\`${tool}\` isn't installed. ${fix}`,
  );
  if (failures.length) return { failures };
  if (!signedIn())
    return {
      failures: ["The GitHub CLI isn't signed in. Run `gh auth login`."],
    };

  let login;
  try {
    login = (await github.request("GET /user")).data.login;
  } catch (error) {
    return {
      failures: [`GitHub didn't accept your gh login (${error.message}).`],
    };
  }
  try {
    // Answers only for an org owner or security manager.
    await github.request("GET /orgs/{org}/security-advisories", {
      org: REPO.owner,
      per_page: 1,
    });
    return { failures: [], login, role: "org owner or security manager" };
  } catch {
    // Not one of those; a repository admin also sees every advisory.
  }
  try {
    const { data } = await github.request("GET /repos/{owner}/{repo}", REPO);
    if (data.permissions?.admin)
      return {
        failures: [],
        login,
        role: `admin of ${REPO.owner}/${REPO.repo}`,
      };
  } catch {
    // Treated as no access below.
  }
  return {
    login,
    failures: [
      `@${login} can't see all of ${REPO.owner}/${REPO.repo}'s security advisories. ` +
        `This report needs an ${REPO.owner} org owner, security manager, or admin of ` +
        `${REPO.owner}/${REPO.repo}; anyone else would get an incomplete list.`,
    ],
  };
}

/** `[{ ghsa, fork }]` for every open advisory that has a temporary private fork. */
async function listAdvisoryForks(github) {
  const forks = [];
  for (const state of ADVISORY_STATES) {
    const advisories = await github.paginate(
      "GET /repos/{owner}/{repo}/security-advisories",
      { ...REPO, state, per_page: 100 },
    );
    for (const advisory of advisories) {
      const fork = advisory.private_fork?.full_name;
      if (!fork) continue;
      if (!FORK_NAME.test(fork))
        throw new Error(
          `${advisory.ghsa_id}'s private fork has an unexpected name: ${fork}`,
        );
      forks.push({ ghsa: advisory.ghsa_id, fork });
    }
  }
  return forks;
}

/**
 * pr-triage's board for one fork. Review bots can't reach a temporary private
 * fork, so the triage doesn't wait on them.
 */
function triageFork(fork) {
  const script = path.join(__dirname, "..", "..", "scripts", "pr-triage.sh");
  return JSON.parse(
    execFileSync("bash", [script, "-R", fork, "--json"], {
      env: { ...process.env, PR_TRIAGE_BOT_TIMEOUT_SECS: "0" },
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString(),
  );
}

/**
 * Builds the report. `triage(fork)` returns pr-triage's board for a fork.
 * Returns `{ report, message }`; throws when any advisory or fork can't be
 * read, or the message is too long to post.
 */
async function buildAdvisoryReport({
  github,
  triage = triageFork,
  now = Date.now(),
  login,
}) {
  const forks = await listAdvisoryForks(github);
  const sources = forks.map(({ ghsa, fork }) => {
    let board;
    try {
      board = triage(fork);
    } catch (error) {
      throw new Error(
        `Couldn't triage ${ghsa}'s fork: ${String(error.stderr ?? error.message).trim()}`,
      );
    }
    // Every fork numbers its PRs from 1; the advisory ID tells them apart.
    const prs = (board.prs ?? []).map((pr) => ({
      ...pr,
      ref: `${ghsa} #${pr.number}`,
    }));
    return {
      owner: REPO.owner,
      repo: fork.split("/")[1],
      board: { ...board, prs },
      base: REPO,
    };
  });

  const warnings = [];
  let slackIdsRaw;
  try {
    slackIdsRaw = (
      await github.request(
        "GET /repos/{owner}/{repo}/actions/variables/{name}",
        {
          ...REPO,
          name: "CODEOWNERS_SLACK_IDS",
        },
      )
    ).data.value;
  } catch (error) {
    warnings.push(
      `Couldn't read CODEOWNERS_SLACK_IDS (${error.message}); nobody is mentioned.`,
    );
  }

  const { report } = await assembleReport({
    github,
    sources,
    slackIdsRaw,
    warnings,
    now,
    title: "Security Advisory PR Report",
    emptyText: "No security advisory PRs are waiting on codeowners today.",
    boardHint: `Run by @${login} with the \`${SKILL}\` agent skill`,
  });
  const message = toSlackMarkdown(report);
  if (message.length > SLACK_MAX_CHARS)
    throw new Error(
      `The message is ${message.length} characters; Slack takes at most ${SLACK_MAX_CHARS}.`,
    );
  return { report, message };
}

module.exports = {
  REPO,
  SLACK_MAX_CHARS,
  checkAccess,
  listAdvisoryForks,
  buildAdvisoryReport,
};

if (require.main === module) {
  const { createGhClient } = require("./gh-local-client.cjs");
  const args = process.argv.slice(2);
  const checkOnly = args[0] === "--check";
  if (args.length > (checkOnly ? 1 : 0)) {
    console.error(
      "Usage: node .github/scripts/security-advisory-pr-report.cjs [--check]",
    );
    process.exit(2);
  }
  const fail = (reasons) => {
    for (const reason of reasons) console.error(`FAIL: ${reason}`);
    process.exit(1);
  };
  (async () => {
    const github = createGhClient();
    const access = await checkAccess({ github });
    if (access.failures.length) fail(access.failures);
    console.error(
      `PASS: signed in to GitHub as @${access.login} (${access.role}).`,
    );
    if (checkOnly) return;
    const { message } = await buildAdvisoryReport({
      github,
      login: access.login,
    });
    process.stdout.write(`${message}\n`);
  })().catch((error) => fail([error.message]));
}
