"use strict";

// Run with: node --test .github/scripts/pr-author-nudge.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseMarker,
  summarize,
  decide,
  nudgeBody,
  warnMessage,
  withState,
  run: runAll,
  MARKER,
} = require("./pr-author-nudge.cjs");

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-10-01T12:00:00Z");
const at = (days) => new Date(T0 + days * DAY).toISOString();

const basePr = (overrides = {}) => ({
  number: 1,
  title: "fix(api): thing",
  isDraft: false,
  authorAssociation: "COLLABORATOR",
  createdAt: at(0),
  mergeable: "MERGEABLE",
  author: { login: "pax", __typename: "User" },
  labels: { nodes: [] },
  timelineItems: { nodes: [] },
  reviewThreads: { nodes: [] },
  commits: {
    nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [] } } } }],
  },
  ...overrides,
});

const thread = (who, days, isResolved = false) => ({
  isResolved,
  comments: { nodes: [{ author: { login: who }, createdAt: at(days) }] },
});

const run = (pr, nowDays, nudge = null, required = ["ci"]) =>
  decide(summarize(pr, required, nudge), T0 + nowDays * DAY);

test("a ready PR with nothing open for the author is not their turn", () => {
  assert.equal(run(basePr(), 30).why, "not author's turn");
});

test("a bot thread with no author reply starts the clock; team nudge at 5 days", () => {
  const pr = basePr({ reviewThreads: { nodes: [thread("coderabbitai", 1)] } });
  assert.equal(run(pr, 5.9).action, "none");
  assert.equal(run(pr, 6.1).action, "nudge");
});

test("a thread the author replied to last is waiting on the reviewer", () => {
  const pr = basePr({ reviewThreads: { nodes: [thread("pax", 1)] } });
  assert.equal(run(pr, 30).why, "not author's turn");
});

test("time waiting on codeowners doesn't count: clock starts at the review", () => {
  // PR sat 20 days with nothing open for the author, then got a thread on day 20.
  const pr = basePr({
    reviewThreads: { nodes: [thread("BigGillyStyle", 20)] },
  });
  assert.equal(run(pr, 24.9).action, "none");
  assert.equal(run(pr, 25.1).action, "nudge");
});

test("an author push or comment resets the clock", () => {
  const pr = basePr({
    reviewThreads: { nodes: [thread("coderabbitai", 1)] },
    timelineItems: {
      nodes: [
        {
          __typename: "IssueComment",
          author: { login: "pax" },
          createdAt: at(6),
        },
      ],
    },
  });
  assert.equal(run(pr, 10.9).action, "none");
  assert.equal(run(pr, 11.1).action, "nudge");
});

test("reviewer and bot comments don't reset the clock", () => {
  const pr = basePr({
    reviewThreads: { nodes: [thread("coderabbitai", 1)] },
    timelineItems: {
      nodes: [
        {
          __typename: "IssueComment",
          author: { login: "greptile-apps" },
          createdAt: at(6),
        },
        {
          __typename: "IssueComment",
          author: { login: "taterhead247" },
          createdAt: at(7),
        },
      ],
    },
  });
  assert.equal(run(pr, 8.1).action, "nudge");
});

test("close needs a nudge, then a Slack heads-up a day before (team)", () => {
  const pr = basePr({ reviewThreads: { nodes: [thread("coderabbitai", 0)] } });
  // No nudge yet at day 20: nudge first, never close cold.
  assert.equal(run(pr, 20).action, "nudge");
  const nudge = { id: 9, nudgedAt: at(5) };
  assert.equal(run(pr, 8.9, nudge).action, "none");
  assert.equal(run(pr, 9.1, nudge).action, "warn");
  // Never warned: still a warning, not a close, however late.
  assert.equal(run(pr, 30, nudge).action, "warn");
  const warned = { ...nudge, warnedAt: at(9.1) };
  assert.equal(run(pr, 9.9, warned).action, "none");
  assert.equal(run(pr, 10.1, warned).action, "close");
});

test("a late warning pushes the close out by at least 20 hours", () => {
  const pr = basePr({ reviewThreads: { nodes: [thread("coderabbitai", 0)] } });
  const warned = { id: 9, nudgedAt: at(5), warnedAt: at(12) };
  assert.equal(run(pr, 12.8, warned).action, "none");
  assert.equal(run(pr, 12.85, warned).action, "close");
  // A warning given before the latest nudge doesn't count.
  const stale = { id: 9, nudgedAt: at(5), warnedAt: at(4) };
  assert.equal(run(pr, 10.1, stale).action, "warn");
});

test("a nudge from an earlier stretch doesn't count toward closing", () => {
  const pr = basePr({
    reviewThreads: { nodes: [thread("coderabbitai", 0)] },
    timelineItems: {
      nodes: [
        { __typename: "PullRequestCommit", commit: { committedDate: at(10) } },
      ],
    },
  });
  const oldNudge = { id: 9, nudgedAt: at(8) };
  assert.equal(run(pr, 14.9, oldNudge).action, "none");
  assert.equal(run(pr, 15.1, oldNudge).action, "nudge");
});

test("drafts follow the same timings", () => {
  const pr = basePr({ isDraft: true });
  assert.equal(run(pr, 4.9).action, "none");
  assert.equal(run(pr, 5.1).action, "nudge");
  assert.equal(run(pr, 9.2, { nudgedAt: at(5.1) }).action, "warn");
  assert.equal(
    run(pr, 10.2, { nudgedAt: at(5.1), warnedAt: at(9.2) }).action,
    "close",
  );
});

test("outside contributors: nudge at 3 days, close at 7", () => {
  for (const authorAssociation of [
    "CONTRIBUTOR",
    "FIRST_TIME_CONTRIBUTOR",
    "NONE",
  ]) {
    const pr = basePr({
      authorAssociation,
      reviewThreads: { nodes: [thread("coderabbitai", 0)] },
    });
    assert.equal(run(pr, 2.9).action, "none");
    assert.equal(run(pr, 3.1).action, "nudge");
    const nudge = { nudgedAt: at(3.1) };
    assert.equal(run(pr, 6.0, nudge).action, "none");
    assert.equal(run(pr, 6.2, nudge).action, "warn");
    const warned = { ...nudge, warnedAt: at(6.2) };
    assert.equal(run(pr, 7.0, warned).action, "none");
    assert.equal(run(pr, 7.2, warned).action, "close");
  }
});

test("a failing required check is the author's turn; optional checks aren't", () => {
  const checks = (name, conclusion) =>
    basePr({
      commits: {
        nodes: [
          {
            commit: {
              statusCheckRollup: {
                contexts: {
                  nodes: [
                    {
                      __typename: "CheckRun",
                      name,
                      conclusion,
                      completedAt: at(2),
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    });
  assert.equal(run(checks("ci", "FAILURE"), 9.1).action, "nudge");
  assert.equal(run(checks("codecov", "FAILURE"), 30).why, "not author's turn");
});

test("changes requested counts until the author pushes", () => {
  const review = {
    __typename: "PullRequestReview",
    state: "CHANGES_REQUESTED",
    author: { login: "evanpetzoldt" },
    submittedAt: at(1),
  };
  const pr = basePr({ timelineItems: { nodes: [review] } });
  assert.equal(run(pr, 8.1).action, "nudge");
  const pushed = basePr({
    timelineItems: {
      nodes: [
        review,
        { __typename: "PullRequestCommit", commit: { committedDate: at(2) } },
      ],
    },
  });
  assert.equal(run(pushed, 30).why, "not author's turn");
});

test("Renovate, release-please, bots and keep-open are exempt", () => {
  const stale = { reviewThreads: { nodes: [thread("coderabbitai", 0)] } };
  assert.equal(
    run(
      basePr({ ...stale, author: { login: "renovate", __typename: "Bot" } }),
      30,
    ).why,
    "exempt",
  );
  assert.equal(
    run(
      basePr({
        ...stale,
        author: { login: "f3-nation-release-please", __typename: "Bot" },
      }),
      30,
    ).why,
    "exempt",
  );
  assert.equal(
    run(basePr({ ...stale, labels: { nodes: [{ name: "keep-open" }] } }), 30)
      .why,
    "exempt",
  );
});

test("the nudge comment carries its state and lists what's open", () => {
  const pr = basePr({
    reviewThreads: {
      nodes: [thread("coderabbitai", 0), thread("greptile-apps", 0)],
    },
  });
  const facts = summarize(pr, ["ci"], null);
  const now = T0 + 8 * DAY;
  const body = nudgeBody(facts, decide(facts, now), now);
  assert.ok(body.startsWith(MARKER));
  assert.match(body, /@pax/);
  assert.match(body, /2 review threads are waiting on you/);
  assert.deepEqual(parseMarker(body), {
    nudgedAt: new Date(now).toISOString(),
  });
});

test("an author's reply inside a review thread resets the clock", () => {
  // Author replied in the thread on day 6; the bot answered after and the
  // thread is still unresolved, so it's the author's turn, counted from day 6.
  const pr = basePr({
    reviewThreads: {
      nodes: [
        {
          isResolved: false,
          comments: {
            nodes: [
              { author: { login: "coderabbitai" }, createdAt: at(1) },
              { author: { login: "pax" }, createdAt: at(6) },
              { author: { login: "coderabbitai" }, createdAt: at(6.01) },
            ],
          },
        },
      ],
    },
  });
  assert.equal(run(pr, 10.9).action, "none");
  assert.equal(run(pr, 11.1).action, "nudge");
});

test("withState rewrites only the marker", () => {
  const body = `${MARKER} {"nudgedAt":"2026-10-06T12:00:00.000Z"} -->\n👋 hi`;
  const next = withState(body, {
    nudgedAt: "2026-10-06T12:00:00.000Z",
    warnedAt: "2026-10-10T12:00:00.000Z",
  });
  assert.ok(next.endsWith("\n👋 hi"));
  assert.deepEqual(parseMarker(next), {
    nudgedAt: "2026-10-06T12:00:00.000Z",
    warnedAt: "2026-10-10T12:00:00.000Z",
  });
});

test("the Slack heads-up links each PR and escapes titles", () => {
  assert.equal(warnMessage([], { owner: "o", repo: "r" }), null);
  const text = warnMessage(
    [
      {
        pr: 12,
        title: "fix <map> & stuff",
        author: "pax",
        age: "9.1d",
        turn: "threads",
        closeAt: "2026-10-11",
      },
    ],
    { owner: "F3-Nation", repo: "f3-nation" },
  );
  assert.match(text, /This PR will auto-close in about a day/);
  assert.match(
    text,
    /<https:\/\/github\.com\/F3-Nation\/f3-nation\/pull\/12\|#12 fix &lt;map&gt; &amp; stuff>/,
  );
  assert.match(text, /keep-open/);
});

// A fake github-script client: one stale PR with a nudge comment from day 5.
function fakeGithub(nudgeState) {
  const writes = [];
  const pr = basePr({
    reviewThreads: { nodes: [thread("coderabbitai", 0)] },
    timelineItems: {
      nodes: [
        {
          __typename: "IssueComment",
          databaseId: 77,
          createdAt: at(5),
          author: { login: "github-actions" },
        },
      ],
    },
  });
  return {
    writes,
    paginate: async () => [
      {
        type: "required_status_checks",
        parameters: { required_status_checks: [{ context: "ci" }] },
      },
    ],
    graphql: async () => ({
      repository: {
        pullRequests: {
          pageInfo: { hasNextPage: false },
          nodes: [pr],
        },
      },
    }),
    request: async (route, params) => {
      if (route.startsWith("GET")) {
        return {
          data: { body: `${MARKER} ${JSON.stringify(nudgeState)} -->\nhi` },
        };
      }
      writes.push({ route, params });
      return { data: {} };
    },
  };
}

test("a live run sends one heads-up, then records it in the marker", async () => {
  const github = fakeGithub({ nudgedAt: at(5) });
  const sent = [];
  const { rows, slackNote } = await runAll({
    github,
    owner: "F3-Nation",
    repo: "f3-nation",
    dryRun: false,
    now: T0 + 9.1 * DAY,
    log: () => {},
    notify: async (text) => sent.push(text),
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0], slackNote);
  assert.equal(rows[0].outcome, "warned in Slack");
  assert.equal(github.writes.length, 1);
  assert.match(github.writes[0].route, /^PATCH .*comments/);
  assert.equal(
    parseMarker(github.writes[0].params.body).warnedAt,
    new Date(T0 + 9.1 * DAY).toISOString(),
  );
});

test("a failed heads-up isn't recorded, so the close waits", async () => {
  const github = fakeGithub({ nudgedAt: at(5) });
  const { rows } = await runAll({
    github,
    owner: "F3-Nation",
    repo: "f3-nation",
    dryRun: false,
    now: T0 + 9.1 * DAY,
    log: () => {},
    notify: async () => {
      throw new Error("invalid_token");
    },
  });
  assert.ok(rows[0].failed);
  assert.equal(github.writes.length, 0);
});

test("a dry run builds the heads-up but writes nothing", async () => {
  const github = fakeGithub({ nudgedAt: at(5) });
  const { rows, slackNote } = await runAll({
    github,
    owner: "F3-Nation",
    repo: "f3-nation",
    dryRun: true,
    now: T0 + 9.1 * DAY,
    log: () => {},
  });
  assert.equal(rows[0].outcome, "would warn");
  assert.match(slackNote, /#1 fix\(api\): thing/);
  assert.equal(github.writes.length, 0);
});
