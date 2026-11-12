"use strict";

/**
 * Security Advisory Report: the Codeowners PR Report (same lists, lights
 * and wording, from codeowners-pr-report.cjs) for the fix PRs in
 * F3-Nation/f3-nation's open security advisories. Two more lists follow, so
 * every open advisory is in the report: each open fix PR appears once, in the
 * codeowners' lists or under "Fix PR waiting on its author" (a draft, or the
 * author's turn), and an advisory without one under "No open fix PR".
 *
 * Those PRs live in each advisory's temporary private fork, which GitHub keeps
 * from every integration, workflow tokens included. So this runs on a
 * codeowner's machine with their own gh login, through the
 * security-advisory-report agent skill, which posts the message to the
 * private #codeowners Slack channel as that person.
 *
 *   node .github/scripts/security-advisory-report.cjs --check   # access checks only
 *   node .github/scripts/security-advisory-report.cjs           # checks, then the message
 *
 * Read-only, and writes no files. Prints the Slack message (Markdown) on
 * stdout; a report too long for one message is split between sections into
 * several, separated by a MESSAGE_BREAK line. Exits 1 with the reasons on
 * stderr when a check fails or any advisory or fork can't be read: a partial
 * list would leave advisories out.
 */

const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");
const {
  assembleReport,
  isListed,
  slackLink,
  toSlackMarkdown,
} = require("./codeowners-pr-report.cjs");
const { DAY_MS, slackEscape } = require("./pr-author-nudge.cjs");

const REPO = { owner: "F3-Nation", repo: "f3-nation" };
// Open advisories; published and closed ones have nothing left to merge.
const ADVISORY_STATES = ["triage", "draft"];
const GHSA_ID = /^GHSA(-[a-z0-9]{4}){3}$/;
const SEVERITIES = ["critical", "high", "medium", "low"];
const FORK_NAME = new RegExp(
  `^${REPO.owner}/${REPO.repo}-ghsa(-[a-z0-9]{4}){3}$`,
);
// Slack's Markdown input takes at most this many characters per message.
const SLACK_MAX_CHARS = 5000;
// Separates messages in the output. Report text can't contain it: titles and
// summaries are Slack-escaped, so they never hold "<" or ">".
const MESSAGE_BREAK = "<<< next Slack message >>>";
const SKILL = "security-advisory-report";

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
// GitHub's answer when the caller lacks access; any other error is a failure.
const isDenied = (error) => error?.status === 403 || error?.status === 404;

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
  } catch (error) {
    // A 403 or 404 means neither; a repository admin also sees every advisory.
    if (!isDenied(error))
      return {
        login,
        failures: [`Couldn't check your org role (${error.message}).`],
      };
  }
  try {
    const { data } = await github.request("GET /repos/{owner}/{repo}", REPO);
    if (data.permissions?.admin)
      return {
        failures: [],
        login,
        role: `admin of ${REPO.owner}/${REPO.repo}`,
      };
  } catch (error) {
    if (!isDenied(error))
      return {
        login,
        failures: [
          `Couldn't check your access to ${REPO.owner}/${REPO.repo} (${error.message}).`,
        ],
      };
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

/**
 * Every open advisory, most severe first, then oldest first:
 * `[{ ghsa, summary, severity, createdAt, fork }]`, where `fork` is its
 * temporary private fork's full name, or null.
 */
async function listAdvisories(github) {
  const advisories = [];
  for (const state of ADVISORY_STATES) {
    const page = await github.paginate(
      "GET /repos/{owner}/{repo}/security-advisories",
      { ...REPO, state, per_page: 100 },
    );
    for (const advisory of page) {
      if (!GHSA_ID.test(advisory.ghsa_id ?? ""))
        throw new Error(
          `An advisory has an unexpected ID: ${advisory.ghsa_id}`,
        );
      const fork = advisory.private_fork?.full_name ?? null;
      if (fork && !FORK_NAME.test(fork))
        throw new Error(
          `${advisory.ghsa_id}'s private fork has an unexpected name: ${fork}`,
        );
      advisories.push({
        ghsa: advisory.ghsa_id,
        summary: advisory.summary ?? "",
        severity: advisory.severity ?? null,
        createdAt: advisory.created_at,
        fork,
      });
    }
  }
  const rank = (a) => {
    const i = SEVERITIES.indexOf(a.severity);
    return i === -1 ? SEVERITIES.length : i;
  };
  return advisories.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0),
  );
}

/** Why a fix PR the codeowners' lists leave out is waiting on its author. */
function authorWait(pr, facts) {
  if (pr.bucket === "DRAFT" || facts?.isDraft) return "draft";
  const reasons = (facts?.reasons ?? []).map((r) => {
    switch (r.kind) {
      case "checks":
        return "required checks failing";
      case "conflict":
        return "merge conflict";
      case "threads":
        return `${r.count} ${r.count === 1 ? "thread" : "threads"} to answer`;
      case "changes":
        return "changes requested";
      default:
        return r.kind;
    }
  });
  if (reasons.length) return reasons.join(", ");
  return pr.bucket === "THREADS"
    ? "unresolved threads"
    : "not ready for review";
}

/**
 * Board PRs still open when facts were collected, by fork. Facts are read
 * after triage from the open PRs, so a board PR without facts has closed.
 */
function openPrsByFork(board, factsByUrl) {
  const prsByFork = new Map();
  for (const pr of board.prs ?? []) {
    if (!factsByUrl.has(pr.url)) continue;
    const fork = pr.url?.match(
      /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\//,
    )?.[1];
    if (!prsByFork.has(fork)) prsByFork.set(fork, []);
    prsByFork.get(fork).push(pr);
  }
  return prsByFork;
}

/** Advisories with no open fix PR. */
const withoutOpenPr = (advisories, board, factsByUrl) => {
  const prsByFork = openPrsByFork(board, factsByUrl);
  return advisories.filter((a) => !prsByFork.get(a.fork)?.length);
};

/**
 * The two lists that put every open advisory in the report: open fix PRs the
 * codeowners' lists leave out, and advisories with no open fix PR.
 */
function advisoryLists(advisories, board, factsByUrl, now) {
  const prsByFork = openPrsByFork(board, factsByUrl);
  const waiting = [];
  const noPr = [];
  for (const advisory of advisories) {
    const prs = prsByFork.get(advisory.fork) ?? [];
    if (!prs.length) {
      const opened = Date.parse(advisory.createdAt);
      const days = Number.isNaN(opened)
        ? null
        : Math.floor(Math.max(0, now - opened) / DAY_MS);
      noPr.push(
        [
          slackLink(
            `https://github.com/${REPO.owner}/${REPO.repo}/security/advisories/${advisory.ghsa}`,
            advisory.ghsa,
            advisory.summary,
          ),
          advisory.severity ?? "no severity",
          ...(days == null ? [] : [`opened ${days}d ago`]),
        ].join(" · "),
      );
      continue;
    }
    for (const pr of prs) {
      const facts = factsByUrl.get(pr.url);
      if (isListed(pr, facts)) continue;
      waiting.push(
        [
          slackLink(pr.url, pr.ref, pr.title),
          `by ${slackEscape(pr.author)}`,
          authorWait(pr, facts),
        ].join(" · "),
      );
    }
  }
  return [
    { heading: "✍️ Fix PR waiting on its author", lines: waiting },
    { heading: "🚧 No open fix PR", lines: noPr },
  ];
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
 * Splits Markdown between its blocks (blank-line separated) into messages of
 * at most `max` characters, in order.
 */
function splitMessages(markdown, max = SLACK_MAX_CHARS) {
  const messages = [];
  for (const block of markdown.split("\n\n")) {
    if (block.length > max)
      throw new Error(
        `A section is ${block.length} characters; Slack takes at most ${max}.`,
      );
    const last = messages.at(-1);
    if (last != null && last.length + 2 + block.length <= max)
      messages[messages.length - 1] = `${last}\n\n${block}`;
    else messages.push(block);
  }
  return messages;
}

/**
 * Builds the report. `triage(fork)` returns pr-triage's board for a fork.
 * Returns `{ report, messages }`, the Slack messages in posting order; throws
 * when any advisory or fork can't be read.
 */
async function buildAdvisoryReport({
  github,
  triage = triageFork,
  now = Date.now(),
  login,
}) {
  const advisories = await listAdvisories(github);
  const forks = advisories.filter((a) => a.fork);
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
    extraLists: (board, factsByUrl) =>
      advisoryLists(advisories, board, factsByUrl, now),
    headerExtras: (board, factsByUrl) => {
      const noPr = withoutOpenPr(advisories, board, factsByUrl).length;
      return noPr
        ? [
            `${noPr} ${noPr === 1 ? "advisory has" : "advisories have"} no open fix PR`,
          ]
        : [];
    },
    // advisoryLists() skips every placed PR, so each must be printed.
    capLists: false,
    title: "Security Advisory Report",
    emptyText: "There are no open security advisories.",
    boardHint: `Run by @${login} with the \`${SKILL}\` agent skill`,
  });
  return { report, messages: splitMessages(toSlackMarkdown(report)) };
}

module.exports = {
  REPO,
  SLACK_MAX_CHARS,
  MESSAGE_BREAK,
  splitMessages,
  checkAccess,
  listAdvisories,
  buildAdvisoryReport,
};

if (require.main === module) {
  const { createGhClient } = require("./gh-local-client.cjs");
  const args = process.argv.slice(2);
  const checkOnly = args[0] === "--check";
  if (args.length > (checkOnly ? 1 : 0)) {
    console.error(
      "Usage: node .github/scripts/security-advisory-report.cjs [--check]",
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
    const { messages } = await buildAdvisoryReport({
      github,
      login: access.login,
    });
    process.stdout.write(`${messages.join(`\n${MESSAGE_BREAK}\n`)}\n`);
  })().catch((error) => fail([error.message]));
}
