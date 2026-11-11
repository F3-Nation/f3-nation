"use strict";

// Run with: node --test .github/scripts/security-advisory-pr-report.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  REPO,
  SLACK_MAX_CHARS,
  checkAccess,
  listAdvisoryForks,
  buildAdvisoryReport,
} = require("./security-advisory-pr-report.cjs");

const NOW = Date.parse("2026-11-11T14:07:00Z");
const FORK_A = "F3-Nation/f3-nation-ghsa-aaaa-bbbb-cccc";
const FORK_B = "F3-Nation/f3-nation-ghsa-dddd-eeee-ffff";
const httpError = (status) =>
  Object.assign(new Error(`HTTP ${status}`), { status });

/**
 * A fake gh client. `routes` maps "GET /path" (placeholders filled) to data or
 * an Error; `prsByRepo` maps a repo name to its open PR nodes for GraphQL.
 */
function fakeGithub({
  routes = {},
  advisories = { draft: [] },
  prsByRepo = {},
}) {
  const calls = [];
  const fill = (route, params) =>
    route.replace(/\{(\w+)\}/g, (_, key) => params[key]);
  const answer = (key) => {
    const value = routes[key];
    if (value instanceof Error) throw value;
    if (value === undefined) throw httpError(404);
    return value;
  };
  return {
    calls,
    request: async (route, params = {}) => {
      const key = fill(route, params);
      calls.push(key);
      return { data: answer(key) };
    },
    paginate: async (route, params = {}) => {
      const key = fill(route, params);
      calls.push(key);
      if (key.endsWith("/security-advisories")) {
        const value = advisories[params.state] ?? [];
        if (value instanceof Error) throw value;
        return value;
      }
      if (key.includes("/rules/branches/")) return [];
      if (key.endsWith("/collaborators"))
        return [{ login: "andy" }, { login: "dan" }];
      return answer(key);
    },
    graphql: async (_query, { repo }) => {
      calls.push(`graphql ${repo}`);
      return {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false },
            nodes: prsByRepo[repo] ?? [],
          },
        },
      };
    },
  };
}

const prNode = (fork, overrides = {}) => ({
  number: 1,
  url: `https://github.com/${fork}/pull/1`,
  title: "fix(api): close the hole",
  isDraft: false,
  createdAt: "2026-11-10T12:00:00Z",
  mergeable: "MERGEABLE",
  authorAssociation: "MEMBER",
  baseRefName: "main",
  author: { login: "amy", __typename: "User" },
  labels: { nodes: [] },
  timelineItems: { nodes: [] },
  reviewThreads: { nodes: [] },
  commits: { nodes: [] },
  ...overrides,
});

const boardFor = (fork, overrides = {}) => ({
  codeowners: ["andy", "dan"],
  truncated: false,
  fetched: 1,
  prs: [
    {
      bucket: "INLINE",
      number: 1,
      title: "fix(api): close the hole",
      url: `https://github.com/${fork}/pull/1`,
      author: "amy",
      authorIsCodeowner: false,
      assignees: [],
      codeownerAssignees: [],
      unresolvedThreads: 0,
      threadOpeners: [],
      approved: false,
      turnSince: "2026-11-10T12:00:00Z",
      note: "",
      ...overrides,
    },
  ],
});

const advisory = (ghsa, fork) => ({
  ghsa_id: ghsa,
  private_fork: fork ? { full_name: fork } : null,
});

// --- checkAccess -----------------------------------------------------------

test("a missing tool fails before GitHub is called", async () => {
  const github = fakeGithub({});
  const result = await checkAccess({
    github,
    has: (tool) => tool !== "gh",
    signedIn: () => true,
  });
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /`gh` isn't installed/);
  assert.deepEqual(github.calls, []);
});

test("every missing tool is named", async () => {
  const result = await checkAccess({
    github: fakeGithub({}),
    has: () => false,
    signedIn: () => true,
  });
  assert.equal(result.failures.length, 2);
  assert.match(result.failures[1], /`jq` isn't installed/);
});

test("a gh that isn't signed in fails before GitHub is called", async () => {
  const github = fakeGithub({});
  const result = await checkAccess({
    github,
    has: () => true,
    signedIn: () => false,
  });
  assert.match(result.failures[0], /gh auth login/);
  assert.deepEqual(github.calls, []);
});

test("an org owner or security manager passes", async () => {
  const result = await checkAccess({
    github: fakeGithub({
      routes: {
        "GET /user": { login: "andy" },
        "GET /orgs/F3-Nation/security-advisories": [],
      },
    }),
    has: () => true,
    signedIn: () => true,
  });
  assert.deepEqual(result.failures, []);
  assert.equal(result.login, "andy");
  assert.equal(result.role, "org owner or security manager");
});

test("a repository admin passes", async () => {
  const result = await checkAccess({
    github: fakeGithub({
      routes: {
        "GET /user": { login: "dan" },
        "GET /orgs/F3-Nation/security-advisories": httpError(403),
        "GET /repos/F3-Nation/f3-nation": {
          permissions: { admin: true, push: true },
        },
      },
    }),
    has: () => true,
    signedIn: () => true,
  });
  assert.deepEqual(result.failures, []);
  assert.equal(result.role, "admin of F3-Nation/f3-nation");
});

test("a writer who isn't an admin fails, so no partial list is built", async () => {
  const result = await checkAccess({
    github: fakeGithub({
      routes: {
        "GET /user": { login: "amy" },
        "GET /orgs/F3-Nation/security-advisories": httpError(403),
        "GET /repos/F3-Nation/f3-nation": {
          permissions: { admin: false, push: true },
        },
      },
    }),
    has: () => true,
    signedIn: () => true,
  });
  assert.equal(result.failures.length, 1);
  assert.match(
    result.failures[0],
    /@amy can't see all of F3-Nation\/f3-nation's security advisories/,
  );
});

test("someone who can't read the repository fails", async () => {
  const result = await checkAccess({
    github: fakeGithub({ routes: { "GET /user": { login: "eve" } } }),
    has: () => true,
    signedIn: () => true,
  });
  assert.match(result.failures[0], /@eve can't see/);
});

test("a login GitHub rejects fails", async () => {
  const result = await checkAccess({
    github: fakeGithub({ routes: { "GET /user": httpError(401) } }),
    has: () => true,
    signedIn: () => true,
  });
  assert.match(result.failures[0], /didn't accept your gh login/);
});

// --- listAdvisoryForks -----------------------------------------------------

test("only open advisories with a private fork are listed", async () => {
  const github = fakeGithub({
    advisories: {
      triage: [advisory("GHSA-aaaa-bbbb-cccc", FORK_A)],
      draft: [
        advisory("GHSA-1111-2222-3333", null),
        advisory("GHSA-dddd-eeee-ffff", FORK_B),
      ],
    },
  });
  assert.deepEqual(await listAdvisoryForks(github), [
    { ghsa: "GHSA-aaaa-bbbb-cccc", fork: FORK_A },
    { ghsa: "GHSA-dddd-eeee-ffff", fork: FORK_B },
  ]);
  assert.ok(
    github.calls.every(
      (c) => !c.includes("published") && !c.includes("closed"),
    ),
  );
});

test("a fork outside the repository's naming is refused", async () => {
  const github = fakeGithub({
    advisories: {
      draft: [advisory("GHSA-aaaa-bbbb-cccc", "someone/elsewhere")],
    },
  });
  await assert.rejects(
    listAdvisoryForks(github),
    /unexpected name: someone\/elsewhere/,
  );
});

test("an advisory list GitHub refuses stops the report", async () => {
  const github = fakeGithub({ advisories: { triage: httpError(403) } });
  await assert.rejects(listAdvisoryForks(github), /HTTP 403/);
});

// --- buildAdvisoryReport ---------------------------------------------------

const slackIdsRoute = {
  "GET /repos/F3-Nation/f3-nation/actions/variables/CODEOWNERS_SLACK_IDS": {
    value: '{"dan":"U0DAN"}',
  },
};

test("fork PRs are listed by advisory, in the Codeowners PR Report's format", async () => {
  const github = fakeGithub({
    routes: slackIdsRoute,
    advisories: {
      draft: [
        advisory("GHSA-aaaa-bbbb-cccc", FORK_A),
        advisory("GHSA-dddd-eeee-ffff", FORK_B),
      ],
    },
    prsByRepo: {
      "f3-nation-ghsa-aaaa-bbbb-cccc": [prNode(FORK_A)],
      "f3-nation-ghsa-dddd-eeee-ffff": [prNode(FORK_B)],
    },
  });
  const { message, report } = await buildAdvisoryReport({
    github,
    triage: (fork) =>
      boardFor(
        fork,
        fork === FORK_B ? { bucket: "LOCAL", codeownerAssignees: ["dan"] } : {},
      ),
    now: NOW,
    login: "andy",
  });
  assert.equal(report.counts.listed, 2);
  assert.match(
    message,
    /^### Security Advisory PR Report · Wed Nov 11 · 2 PRs need a codeowner/,
  );
  assert.match(
    message,
    /\[GHSA-aaaa-bbbb-cccc #1 fix\(api\): close the hole\]\(https:\/\/github\.com\/F3-Nation\/f3-nation-ghsa-aaaa-bbbb-cccc\/pull\/1\)/,
  );
  assert.match(
    message,
    /\*\*🧪 Needs `\/pr-local-test`\*\* · 1\n• .*GHSA-dddd-eeee-ffff #1.* · <@U0DAN> · /,
  );
  assert.match(
    message,
    /Run by @andy with the `security-advisory-pr-report` agent skill/,
  );
  // Branch rules and the team come from the advisory's repo; forks have neither.
  assert.ok(
    github.calls.includes("GET /repos/F3-Nation/f3-nation/rules/branches/main"),
  );
  assert.ok(
    !github.calls.some((c) => c.includes("ghsa") && c.includes("/rules/")),
  );
});

test("a fork PR that is its author's turn is left out, as in the daily report", async () => {
  const fork = FORK_A;
  const github = fakeGithub({
    routes: slackIdsRoute,
    advisories: { draft: [advisory("GHSA-aaaa-bbbb-cccc", fork)] },
    prsByRepo: {
      "f3-nation-ghsa-aaaa-bbbb-cccc": [
        prNode(fork, {
          timelineItems: {
            nodes: [
              {
                __typename: "PullRequestReview",
                submittedAt: "2026-11-10T13:00:00Z",
                state: "CHANGES_REQUESTED",
                authorAssociation: "MEMBER",
                author: { login: "dan", __typename: "User" },
              },
            ],
          },
        }),
      ],
    },
  });
  const { report, message } = await buildAdvisoryReport({
    github,
    triage: (f) =>
      boardFor(f, { bucket: "MANUAL", codeownerAssignees: ["dan"] }),
    now: NOW,
    login: "andy",
  });
  assert.equal(report.counts.listed, 0);
  assert.match(
    message,
    /No security advisory PRs are waiting on codeowners today\./,
  );
});

test("no forks gives the empty message", async () => {
  const { message } = await buildAdvisoryReport({
    github: fakeGithub({ routes: slackIdsRoute }),
    triage: () => assert.fail("nothing to triage"),
    now: NOW,
    login: "andy",
  });
  assert.match(
    message,
    /^No security advisory PRs are waiting on codeowners today\./,
  );
});

test("a fork that can't be triaged stops the whole report", async () => {
  const github = fakeGithub({
    routes: slackIdsRoute,
    advisories: { draft: [advisory("GHSA-aaaa-bbbb-cccc", FORK_A)] },
  });
  await assert.rejects(
    buildAdvisoryReport({
      github,
      triage: () => {
        throw Object.assign(new Error("exit 1"), {
          stderr: "HTTP 404 Not Found\n",
        });
      },
      now: NOW,
      login: "andy",
    }),
    /Couldn't triage GHSA-aaaa-bbbb-cccc's fork: HTTP 404 Not Found/,
  );
});

test("unreadable Slack IDs leave a warning and no mentions", async () => {
  const github = fakeGithub({
    advisories: { draft: [advisory("GHSA-aaaa-bbbb-cccc", FORK_A)] },
    prsByRepo: { "f3-nation-ghsa-aaaa-bbbb-cccc": [prNode(FORK_A)] },
  });
  const { message } = await buildAdvisoryReport({
    github,
    triage: (fork) =>
      boardFor(fork, { bucket: "LOCAL", codeownerAssignees: ["dan"] }),
    now: NOW,
    login: "andy",
  });
  assert.match(message, /⚠️ Couldn't read CODEOWNERS_SLACK_IDS/);
  assert.match(message, / · @dan · /);
});

test("a title can't notify the channel or start its own link", async () => {
  const github = fakeGithub({
    routes: slackIdsRoute,
    advisories: { draft: [advisory("GHSA-aaaa-bbbb-cccc", FORK_A)] },
    prsByRepo: { "f3-nation-ghsa-aaaa-bbbb-cccc": [prNode(FORK_A)] },
  });
  const { message } = await buildAdvisoryReport({
    github,
    triage: (fork) =>
      boardFor(fork, {
        title: "@here <!channel> ](https://phish.example) x",
        author: "everyone",
      }),
    now: NOW,
    login: "andy",
  });
  assert.doesNotMatch(message, /@here|@everyone|<!channel>/);
  assert.doesNotMatch(message, /\]\(https:\/\/phish/);
  assert.match(
    message,
    /\[GHSA-aaaa-bbbb-cccc #1 @\u200bhere &lt;!channel&gt; \)\(https:\/\/phish\.example\) x\]\(https:\/\/github\.com\//,
  );
});

test("a message too long for Slack is refused rather than cut", async () => {
  const forks = Array.from({ length: 40 }, (_, i) => {
    const id = String(i).padStart(4, "0");
    return {
      ghsa: `GHSA-${id}-bbbb-cccc`,
      fork: `F3-Nation/f3-nation-ghsa-${id}-bbbb-cccc`,
    };
  });
  const github = fakeGithub({
    routes: slackIdsRoute,
    advisories: { draft: forks.map((f) => advisory(f.ghsa, f.fork)) },
    prsByRepo: Object.fromEntries(
      forks.map((f) => [f.fork.split("/")[1], [prNode(f.fork)]]),
    ),
  });
  await assert.rejects(
    buildAdvisoryReport({
      github,
      // Each PR in its own list position, across all four lists.
      triage: (fork) => {
        const i = Number(fork.match(/ghsa-(\d{4})/)[1]);
        const bucket = ["INLINE", "LOCAL", "MANUAL", "REPLY"][i % 4];
        return boardFor(fork, {
          bucket,
          title: "x".repeat(80),
          codeownerAssignees: bucket === "INLINE" ? [] : ["dan"],
          unresolvedThreads: 1,
          threadOpeners: ["dan"],
        });
      },
      now: NOW,
      login: "andy",
    }),
    new RegExp(`Slack takes at most ${SLACK_MAX_CHARS}`),
  );
});

test("the report reads only its own repository", () => {
  assert.deepEqual(REPO, { owner: "F3-Nation", repo: "f3-nation" });
});
