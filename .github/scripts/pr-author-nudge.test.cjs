"use strict";

// Run with: node --test .github/scripts/pr-author-nudge.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseMarker,
  summarize,
  decide,
  nudgeBody,
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

test("close needs a nudge in this stretch and 5 more days (team)", () => {
  const pr = basePr({ reviewThreads: { nodes: [thread("coderabbitai", 0)] } });
  // No nudge yet at day 20: nudge first, never close cold.
  assert.equal(run(pr, 20).action, "nudge");
  const nudge = { id: 9, nudgedAt: at(5) };
  assert.equal(run(pr, 9.9, nudge).action, "none");
  assert.equal(run(pr, 10.1, nudge).action, "close");
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
  assert.equal(run(pr, 10.2, { nudgedAt: at(5.1) }).action, "close");
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
    assert.equal(run(pr, 7.0, nudge).action, "none");
    assert.equal(run(pr, 7.2, nudge).action, "close");
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
