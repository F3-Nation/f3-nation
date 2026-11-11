"use strict";

// Run with: node --test .github/scripts/security-advisory-pr-report.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  REPO,
  SLACK_MAX_CHARS,
  MESSAGE_BREAK,
  splitMessages,
  checkAccess,
  listAdvisories,
  buildAdvisoryReport,
} = require("./security-advisory-pr-report.cjs");
const { toSlackMarkdown } = require("./codeowners-pr-report.cjs");

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

const advisory = (ghsa, fork, overrides = {}) => ({
  ghsa_id: ghsa,
  summary: `Problem ${ghsa}`,
  severity: "medium",
  created_at: "2026-11-07T15:00:00Z",
  private_fork: fork ? { full_name: fork } : null,
  ...overrides,
});
const GHSA_A = "GHSA-aaaa-bbbb-cccc";
const GHSA_B = "GHSA-dddd-eeee-ffff";
const GHSA_C = "GHSA-1111-2222-3333";

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

// --- listAdvisories --------------------------------------------------------

test("every open advisory is listed, most severe then oldest first", async () => {
  const github = fakeGithub({
    advisories: {
      triage: [advisory(GHSA_A, FORK_A, { severity: "low" })],
      draft: [
        advisory(GHSA_C, null, {
          severity: "high",
          created_at: "2026-11-10T00:00:00Z",
        }),
        advisory(GHSA_B, FORK_B, {
          severity: "high",
          created_at: "2026-11-01T00:00:00Z",
        }),
      ],
    },
  });
  const listed = await listAdvisories(github);
  assert.deepEqual(
    listed.map((a) => [a.ghsa, a.fork]),
    [
      [GHSA_B, FORK_B],
      [GHSA_C, null],
      [GHSA_A, FORK_A],
    ],
  );
  assert.ok(
    github.calls.every(
      (c) => !c.includes("published") && !c.includes("closed"),
    ),
  );
});

test("a fork outside the repository's naming is refused", async () => {
  const github = fakeGithub({
    advisories: { draft: [advisory(GHSA_A, "someone/elsewhere")] },
  });
  await assert.rejects(
    listAdvisories(github),
    /unexpected name: someone\/elsewhere/,
  );
});

test("an advisory ID outside GitHub's format is refused", async () => {
  const github = fakeGithub({
    advisories: { draft: [advisory("GHSA-x|evil", null)] },
  });
  await assert.rejects(listAdvisories(github), /unexpected ID: GHSA-x\|evil/);
});

test("an advisory list GitHub refuses stops the report", async () => {
  const github = fakeGithub({ advisories: { triage: httpError(403) } });
  await assert.rejects(listAdvisories(github), /HTTP 403/);
});

// --- buildAdvisoryReport ---------------------------------------------------

const slackIdsRoute = {
  "GET /repos/F3-Nation/f3-nation/actions/variables/CODEOWNERS_SLACK_IDS": {
    value: '{"dan":"U0DAN"}',
  },
};
const build = (github, triage) =>
  buildAdvisoryReport({ github, triage, now: NOW, login: "andy" });
const text = ({ messages }) => messages.join(`\n${MESSAGE_BREAK}\n`);

test("fork PRs are listed by advisory, in the Codeowners PR Report's format", async () => {
  const github = fakeGithub({
    routes: slackIdsRoute,
    advisories: { draft: [advisory(GHSA_A, FORK_A), advisory(GHSA_B, FORK_B)] },
    prsByRepo: {
      "f3-nation-ghsa-aaaa-bbbb-cccc": [prNode(FORK_A)],
      "f3-nation-ghsa-dddd-eeee-ffff": [prNode(FORK_B)],
    },
  });
  const result = await build(github, (fork) =>
    boardFor(
      fork,
      fork === FORK_B ? { bucket: "LOCAL", codeownerAssignees: ["dan"] } : {},
    ),
  );
  const message = text(result);
  assert.equal(result.report.counts.listed, 2);
  assert.equal(result.messages.length, 1);
  assert.match(
    message,
    /^### Security Advisory PR Report · Wed Nov 11 · 2 PRs need a codeowner · 🔴 0 🟡 0\n/,
  );
  assert.match(
    message,
    /\[GHSA-aaaa-bbbb-cccc #1 fix\(api\): close the hole\]\(https:\/\/github\.com\/F3-Nation\/f3-nation-ghsa-aaaa-bbbb-cccc\/pull\/1\)/,
  );
  assert.match(
    message,
    /\*\*🧪 Needs `\/pr-local-test`\*\* · 1\n• .*GHSA-dddd-eeee-ffff #1.* · <@U0DAN> · /,
  );
  assert.doesNotMatch(message, /waiting on its author|No open fix PR/);
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

test("every open advisory appears once: listed, waiting on its author, or with no fix PR", async () => {
  const FORK_C = "F3-Nation/f3-nation-ghsa-1111-2222-3333";
  const github = fakeGithub({
    routes: slackIdsRoute,
    advisories: {
      draft: [
        advisory(GHSA_A, FORK_A),
        advisory(GHSA_B, FORK_B),
        // Its fork's only PR was closed, so triage finds no open PR.
        advisory(GHSA_C, FORK_C, { summary: "Tokens leak", severity: "high" }),
        advisory("GHSA-4444-5555-6666", null, {
          summary: "No fork yet",
          severity: null,
          created_at: "2026-11-01T14:07:00Z",
        }),
      ],
    },
    prsByRepo: {
      "f3-nation-ghsa-aaaa-bbbb-cccc": [prNode(FORK_A)],
      "f3-nation-ghsa-dddd-eeee-ffff": [prNode(FORK_B, { isDraft: true })],
    },
  });
  const result = await build(github, (fork) =>
    fork === FORK_C
      ? { codeowners: [], prs: [] }
      : boardFor(
          fork,
          fork === FORK_B ? { bucket: "DRAFT", author: "dan" } : {},
        ),
  );
  const message = text(result);
  assert.match(
    message,
    /^### .* · 1 PR needs a codeowner · 🔴 0 🟡 0 · 2 advisories have no open fix PR\n/,
  );
  assert.match(
    message,
    /\*\*✍️ Fix PR waiting on its author\*\* · 1\n• \[GHSA-dddd-eeee-ffff #1 fix\(api\): close the hole\]\(https:\/\/github\.com\/F3-Nation\/f3-nation-ghsa-dddd-eeee-ffff\/pull\/1\) · by dan · draft\n/,
  );
  assert.match(
    message,
    /\*\*🚧 No open fix PR\*\* · 2\n• \[GHSA-1111-2222-3333 Tokens leak\]\(https:\/\/github\.com\/F3-Nation\/f3-nation\/security\/advisories\/GHSA-1111-2222-3333\) · high · opened 3d ago\n• \[GHSA-4444-5555-6666 No fork yet\]\(https:\/\/github\.com\/F3-Nation\/f3-nation\/security\/advisories\/GHSA-4444-5555-6666\) · no severity · opened 10d ago\n/,
  );
  for (const ghsa of [GHSA_A, GHSA_B, GHSA_C, "GHSA-4444-5555-6666"])
    assert.equal(
      message.split("\n").filter((line) => line.includes(ghsa)).length,
      1,
      `${ghsa} is on one line`,
    );
});

test("a fix PR that is its author's turn says why", async () => {
  const github = fakeGithub({
    routes: slackIdsRoute,
    advisories: { draft: [advisory(GHSA_A, FORK_A)] },
    prsByRepo: {
      "f3-nation-ghsa-aaaa-bbbb-cccc": [
        prNode(FORK_A, {
          mergeable: "CONFLICTING",
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
  const result = await build(github, (f) =>
    boardFor(f, { bucket: "MANUAL", codeownerAssignees: ["dan"] }),
  );
  assert.equal(result.report.counts.listed, 0);
  assert.match(text(result), /· by amy · merge conflict, changes requested\n/);
  assert.doesNotMatch(text(result), /✅ Needs final review/);
});

test("no open advisories gives the empty message", async () => {
  const result = await build(fakeGithub({ routes: slackIdsRoute }), () =>
    assert.fail("nothing to triage"),
  );
  assert.deepEqual(result.messages, [
    "There are no open security advisories.\n\nRun by @andy with the `security-advisory-pr-report` agent skill · reply in this thread to take a PR or ask for help",
  ]);
});

test("a fork that can't be triaged stops the whole report", async () => {
  const github = fakeGithub({
    routes: slackIdsRoute,
    advisories: { draft: [advisory(GHSA_A, FORK_A)] },
  });
  await assert.rejects(
    build(github, () => {
      throw Object.assign(new Error("exit 1"), {
        stderr: "HTTP 404 Not Found\n",
      });
    }),
    /Couldn't triage GHSA-aaaa-bbbb-cccc's fork: HTTP 404 Not Found/,
  );
});

test("unreadable Slack IDs leave a warning and no mentions", async () => {
  const github = fakeGithub({
    advisories: { draft: [advisory(GHSA_A, FORK_A)] },
    prsByRepo: { "f3-nation-ghsa-aaaa-bbbb-cccc": [prNode(FORK_A)] },
  });
  const message = text(
    await build(github, (fork) =>
      boardFor(fork, { bucket: "LOCAL", codeownerAssignees: ["dan"] }),
    ),
  );
  assert.match(message, /⚠️ Couldn't read CODEOWNERS_SLACK_IDS/);
  assert.match(message, / · @dan · /);
});

test("a title or summary can't notify the channel or start its own link", async () => {
  const github = fakeGithub({
    routes: slackIdsRoute,
    advisories: {
      draft: [
        advisory(GHSA_A, FORK_A),
        advisory(GHSA_B, null, {
          summary: "@channel [x](https://phish.example)",
        }),
      ],
    },
    prsByRepo: { "f3-nation-ghsa-aaaa-bbbb-cccc": [prNode(FORK_A)] },
  });
  const message = text(
    await build(github, (fork) =>
      boardFor(fork, {
        title: "@here <!channel> ](https://phish.example) x",
        author: "everyone",
      }),
    ),
  );
  assert.doesNotMatch(message, /@here|@everyone|@channel|<!channel>/);
  assert.doesNotMatch(message, /\]\(https:\/\/phish/);
  assert.match(
    message,
    /\[GHSA-aaaa-bbbb-cccc #1 @​here &lt;!channel&gt; \)\(https:\/\/phish\.example\) x\]\(https:\/\/github\.com\//,
  );
  assert.match(
    message,
    /\[GHSA-dddd-eeee-ffff @​channel \(x\)\(https:\/\/phish\.example\)\]\(https:\/\/github\.com\/F3-Nation\/f3-nation\/security\//,
  );
});

test("a long report is split between sections into messages Slack accepts", async () => {
  const ids = Array.from({ length: 40 }, (_, i) => String(i).padStart(4, "0"));
  const github = fakeGithub({
    routes: slackIdsRoute,
    advisories: {
      draft: ids.map((id) =>
        advisory(
          `GHSA-${id}-bbbb-cccc`,
          i(id) % 2 ? null : `F3-Nation/f3-nation-ghsa-${id}-bbbb-cccc`,
          {
            summary: "y".repeat(80),
          },
        ),
      ),
    },
    prsByRepo: Object.fromEntries(
      ids.map((id) => [
        `f3-nation-ghsa-${id}-bbbb-cccc`,
        [prNode(`F3-Nation/f3-nation-ghsa-${id}-bbbb-cccc`)],
      ]),
    ),
  });
  function i(id) {
    return Number(id);
  }
  const result = await build(github, (fork) => {
    const n = Number(fork.match(/ghsa-(\d{4})/)[1]);
    const bucket = ["INLINE", "LOCAL", "MANUAL", "REPLY"][(n / 2) % 4];
    return boardFor(fork, {
      bucket,
      title: "x".repeat(80),
      codeownerAssignees: bucket === "INLINE" ? [] : ["dan"],
      unresolvedThreads: 1,
      threadOpeners: ["dan"],
    });
  });
  assert.ok(result.messages.length > 1);
  for (const message of result.messages)
    assert.ok(message.length <= SLACK_MAX_CHARS);
  assert.match(result.messages[0], /^### Security Advisory PR Report/);
  assert.match(result.messages.at(-1), /Run by @andy/);
  // Nothing is lost or reordered in the split.
  assert.equal(result.messages.join("\n\n"), toSlackMarkdown(result.report));
});

test("splitMessages packs blocks in order and refuses an oversized one", () => {
  assert.deepEqual(splitMessages("aaa\n\nbbb\n\ncc", 8), ["aaa\n\nbbb", "cc"]);
  assert.throws(
    () => splitMessages("short\n\n" + "z".repeat(20), 10),
    /A section is 20 characters/,
  );
});

test("the report reads only its own repository", () => {
  assert.deepEqual(REPO, { owner: "F3-Nation", repo: "f3-nation" });
});
