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
    author: { login: "evanpetzoldt", __typename: "User" },
    authorAssociation: "MEMBER",
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

test("Renovate, release-please, bots, deleted accounts and keep-open are exempt", () => {
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
  assert.equal(run(basePr({ ...stale, author: null }), 30).why, "exempt");
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

// A fake github-script client. By default: one PR with a bot thread from day 0
// and the bot's reminder comment (day 5) carrying `nudgeState`. Pass a null
// `nudgeState` for a PR the bot never commented on.
function fakeGithub(nudgeState, prOverrides = {}, collaborators = []) {
  const writes = [];
  const botComment = {
    __typename: "IssueComment",
    databaseId: 77,
    createdAt: at(5),
    author: { login: "github-actions" },
  };
  const pr = basePr({
    reviewThreads: { nodes: [thread("coderabbitai", 0)] },
    timelineItems: { nodes: nudgeState ? [botComment] : [] },
    ...prOverrides,
  });
  if (nudgeState && prOverrides.timelineItems) {
    pr.timelineItems = {
      nodes: [botComment, ...prOverrides.timelineItems.nodes],
    };
  }
  return {
    writes,
    paginate: async (route) => {
      if (route.includes("/collaborators")) {
        if (collaborators instanceof Error) throw collaborators;
        return collaborators.map((login) => ({ login }));
      }
      return [
        {
          type: "required_status_checks",
          parameters: { required_status_checks: [{ context: "ci" }] },
        },
      ];
    },
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

const liveRun = (github, nowDays, extra = {}) =>
  runAll({
    github,
    owner: "F3-Nation",
    repo: "f3-nation",
    dryRun: false,
    now: T0 + nowDays * DAY,
    log: () => {},
    notify: async () => {},
    ...extra,
  });

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

test("without a Slack webhook a live run records nothing, so the close waits", async () => {
  const github = fakeGithub({ nudgedAt: at(5) });
  const { rows } = await liveRun(github, 9.1, { notify: null });
  assert.ok(rows[0].failed);
  assert.match(rows[0].outcome, /no Slack webhook/);
  assert.equal(github.writes.length, 0);
});

test("a live close comments, labels stale, then closes", async () => {
  const github = fakeGithub({ nudgedAt: at(5), warnedAt: at(9.1) });
  const { rows } = await liveRun(github, 10.1);
  assert.equal(rows[0].outcome, "closed");
  assert.deepEqual(
    github.writes.map((w) => w.route),
    [
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      "POST /repos/{owner}/{repo}/issues/{issue_number}/labels",
      "PATCH /repos/{owner}/{repo}/pulls/{pull_number}",
    ],
  );
  assert.match(github.writes[0].params.body, /^Closing this PR/);
  assert.match(github.writes[0].params.body, /with nothing changed since/);
  assert.deepEqual(github.writes[1].params.labels, ["stale"]);
  assert.equal(github.writes[2].params.state, "closed");
});

test("a first live nudge posts one comment carrying its state", async () => {
  const github = fakeGithub(null);
  const { rows } = await liveRun(github, 6);
  assert.equal(rows[0].outcome, "nudged");
  assert.equal(github.writes.length, 1);
  assert.equal(
    github.writes[0].route,
    "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
  );
  assert.equal(
    parseMarker(github.writes[0].params.body).nudgedAt,
    new Date(T0 + 6 * DAY).toISOString(),
  );
});

test("a repeat nudge posts a new comment, so the author is notified again", async () => {
  // Reminded on day 5, the author pushed on day 6, and the thread is still open.
  const github = fakeGithub(
    { nudgedAt: at(5) },
    {
      timelineItems: {
        nodes: [{ __typename: "HeadRefForcePushedEvent", createdAt: at(6) }],
      },
    },
  );
  const { rows } = await liveRun(github, 11.1);
  assert.equal(rows[0].outcome, "nudged");
  assert.equal(github.writes.length, 1);
  assert.match(
    github.writes[0].route,
    /^POST .*\/issues\/\{issue_number\}\/comments$/,
  );
  assert.match(github.writes[0].params.body, /@pax/);
});

test("a dry run reports nudges and closes but writes nothing", async () => {
  for (const [state, nowDays, outcome] of [
    [null, 6, "would nudge"],
    [{ nudgedAt: at(5), warnedAt: at(9.1) }, 10.1, "would close"],
    [{ nudgedAt: at(5) }, 12, "not author's turn, would pause"],
  ]) {
    const overrides =
      outcome === "not author's turn, would pause"
        ? { reviewThreads: { nodes: [] } }
        : {};
    const github = fakeGithub(state, overrides);
    const { rows } = await liveRun(github, nowDays, { dryRun: true });
    assert.equal(rows[0].outcome, outcome);
    assert.equal(github.writes.length, 0);
  }
});

test("a reminded PR that stops being the author's turn records a pause, once", async () => {
  const github = fakeGithub(
    { nudgedAt: at(5), warnedAt: at(9) },
    { reviewThreads: { nodes: [thread("coderabbitai", 0, true)] } },
  );
  const { rows } = await liveRun(github, 9.5);
  assert.equal(rows[0].outcome, "not author's turn, paused");
  assert.equal(github.writes.length, 1);
  assert.match(github.writes[0].route, /^PATCH .*comments/);
  assert.deepEqual(parseMarker(github.writes[0].params.body), {
    nudgedAt: at(5),
    warnedAt: at(9),
    pausedAt: new Date(T0 + 9.5 * DAY).toISOString(),
  });

  const again = fakeGithub(
    { nudgedAt: at(5), warnedAt: at(9), pausedAt: at(9.5) },
    { reviewThreads: { nodes: [thread("coderabbitai", 0, true)] } },
  );
  await liveRun(again, 12);
  assert.equal(again.writes.length, 0);
});

test("keep-open on a reminded PR records a pause too", async () => {
  const github = fakeGithub(
    { nudgedAt: at(5), warnedAt: at(9) },
    { labels: { nodes: [{ name: "keep-open" }] } },
  );
  const { rows } = await liveRun(github, 9.5);
  assert.equal(rows[0].outcome, "exempt, paused");
  assert.ok(parseMarker(github.writes[0].params.body).pausedAt);
});

test("after a pause, an old reminder and heads-up don't count toward a close", () => {
  // Reminded day 5, warned day 9, paused day 10 (keep-open added, or the
  // reviewer resolved the thread). On day 25 it's the author's turn again.
  const pr = basePr({
    reviewThreads: { nodes: [thread("coderabbitai", 0.1)] },
  });
  const paused = { id: 9, nudgedAt: at(5), warnedAt: at(9), pausedAt: at(10) };
  assert.equal(run(pr, 25, paused).action, "nudge");
  const conflicted = basePr({ mergeable: "CONFLICTING" });
  assert.equal(run(conflicted, 25, paused).action, "nudge");
  // Without the pause it would have closed straight away.
  assert.equal(run(pr, 25, { ...paused, pausedAt: undefined }).action, "close");
});

test("a reopen by anyone starts a fresh clock", () => {
  const pr = basePr({
    reviewThreads: { nodes: [thread("coderabbitai", 0)] },
    timelineItems: {
      nodes: [
        {
          __typename: "ReopenedEvent",
          createdAt: at(12),
          actor: { login: "BigGillyStyle" },
        },
      ],
    },
  });
  const old = { id: 9, nudgedAt: at(5), warnedAt: at(9) };
  assert.equal(run(pr, 12.5, old).action, "none");
  assert.equal(run(pr, 17.1, old).action, "nudge");
});

test("a force-push resets the clock", () => {
  const pr = basePr({
    reviewThreads: { nodes: [thread("coderabbitai", 1)] },
    timelineItems: {
      nodes: [{ __typename: "HeadRefForcePushedEvent", createdAt: at(6) }],
    },
  });
  assert.equal(run(pr, 10.9).action, "none");
  assert.equal(run(pr, 11.1).action, "nudge");
});

test("the author's own review resets the clock", () => {
  const pr = basePr({
    reviewThreads: { nodes: [thread("coderabbitai", 1)] },
    timelineItems: {
      nodes: [
        {
          __typename: "PullRequestReview",
          submittedAt: at(6),
          state: "COMMENTED",
          author: { login: "pax" },
        },
      ],
    },
  });
  assert.equal(run(pr, 10.9).action, "none");
  assert.equal(run(pr, 11.1).action, "nudge");
});

test("a bot commenting again in an unanswered thread doesn't move the clock", () => {
  const pr = basePr({
    reviewThreads: {
      nodes: [
        {
          isResolved: false,
          comments: {
            nodes: [
              { author: { login: "coderabbitai" }, createdAt: at(1) },
              { author: { login: "coderabbitai" }, createdAt: at(4) },
            ],
          },
        },
      ],
    },
  });
  assert.equal(run(pr, 6.1).action, "nudge");
});

test("a merge conflict is the author's turn and names the base branch", () => {
  const pr = basePr({ mergeable: "CONFLICTING", baseRefName: "develop" });
  const facts = summarize(pr, ["ci"], null);
  assert.equal(facts.reasons[0].kind, "conflict");
  assert.equal(run(pr, 4.9).action, "none");
  const decision = run(pr, 5.1);
  assert.equal(decision.action, "nudge");
  assert.match(
    nudgeBody(facts, decision, T0 + 5.1 * DAY),
    /conflict with `develop`/,
  );
});

test("a failing required legacy status is the author's turn", () => {
  const pr = basePr({
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                nodes: [
                  {
                    __typename: "StatusContext",
                    context: "ci",
                    state: "FAILURE",
                    createdAt: at(1),
                  },
                ],
              },
            },
          },
        },
      ],
    },
  });
  assert.equal(run(pr, 5.9).action, "none");
  assert.equal(run(pr, 6.1).action, "nudge");
});

const withContexts = (nodes) =>
  basePr({
    commits: {
      nodes: [{ commit: { statusCheckRollup: { contexts: { nodes } } } }],
    },
  });
const checkRun = (conclusion, days) => ({
  __typename: "CheckRun",
  name: "ci",
  conclusion,
  completedAt: at(days),
});

test("the newest run of a check wins", () => {
  const fixed = withContexts([checkRun("FAILURE", 2), checkRun("SUCCESS", 3)]);
  assert.equal(run(fixed, 30).why, "not author's turn");
  const broke = withContexts([checkRun("SUCCESS", 2), checkRun("FAILURE", 3)]);
  assert.equal(run(broke, 8.1).action, "nudge");
});

test("a passing legacy status doesn't hide a failing check run of the same name", () => {
  const pr = withContexts([
    checkRun("FAILURE", 2),
    {
      __typename: "StatusContext",
      context: "ci",
      state: "SUCCESS",
      createdAt: at(3),
    },
  ]);
  assert.equal(run(pr, 7.1).action, "nudge");
});

test("a PR into another branch isn't judged by main's required checks", async () => {
  const github = fakeGithub(null, {
    baseRefName: "release",
    reviewThreads: { nodes: [] },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: { nodes: [checkRun("FAILURE", 1)] },
            },
          },
        },
      ],
    },
  });
  const { rows } = await liveRun(github, 30, { dryRun: true });
  assert.equal(rows[0].outcome, "not author's turn");
});

test("only a team member's or a bot's change request is the author's turn", () => {
  const review = (author, authorAssociation) => ({
    __typename: "PullRequestReview",
    state: "CHANGES_REQUESTED",
    author,
    authorAssociation,
    submittedAt: at(1),
  });
  const drive = basePr({
    timelineItems: {
      nodes: [review({ login: "passerby", __typename: "User" }, "NONE")],
    },
  });
  assert.equal(run(drive, 30).why, "not author's turn");
  const bot = basePr({
    timelineItems: {
      nodes: [review({ login: "coderabbitai", __typename: "Bot" }, "NONE")],
    },
  });
  assert.equal(run(bot, 8.1).action, "nudge");
});

test("a rerun still in progress replaces the failed run", () => {
  const pr = withContexts([
    {
      __typename: "CheckRun",
      name: "ci",
      conclusion: "FAILURE",
      startedAt: at(1.9),
      completedAt: at(2),
    },
    {
      __typename: "CheckRun",
      name: "ci",
      conclusion: null,
      startedAt: at(3),
      completedAt: null,
    },
  ]);
  assert.equal(run(pr, 30).why, "not author's turn");
});

test("a late heads-up shows the earliest close the next run will allow", () => {
  const pr = basePr({ reviewThreads: { nodes: [thread("coderabbitai", 0)] } });
  const nudge = { id: 9, nudgedAt: at(5) };
  const late = run(pr, 12, nudge);
  assert.equal(late.action, "warn");
  const warned = { ...nudge, warnedAt: at(12) };
  // The first moment the close is allowed is exactly the advertised one.
  assert.equal(run(pr, 12 + 20 / 24 - 0.001, warned).action, "none");
  assert.equal(run(pr, 12 + 20 / 24, warned).action, "close");
  assert.equal(late.closeAt, T0 + 12 * DAY + 20 * 60 * 60 * 1000);
});

test("anyone with push access gets the team timings, whatever GitHub's association says", async () => {
  const outside = { authorAssociation: "CONTRIBUTOR" };
  const pr = basePr({
    ...outside,
    reviewThreads: { nodes: [thread("coderabbitai", 0)] },
  });
  assert.equal(summarize(pr, [], null).tier, "outside");
  assert.equal(summarize(pr, [], null, new Set(["pax"])).tier, "team");

  // A private org member shows up as a collaborator; day 4 is under the team limit.
  const github = fakeGithub(null, outside, ["pax"]);
  const { rows, notes } = await liveRun(github, 4, { dryRun: true });
  assert.equal(rows[0].tier, "team");
  assert.equal(rows[0].outcome, "author's turn, under the limit");
  assert.deepEqual(notes, []);
});

test("if collaborators can't be listed, the run notes it and uses the association", async () => {
  const github = fakeGithub(
    null,
    { authorAssociation: "CONTRIBUTOR" },
    Object.assign(new Error("Resource not accessible by integration"), {
      status: 403,
    }),
  );
  const { rows, notes } = await liveRun(github, 4, { dryRun: true });
  assert.equal(rows[0].tier, "outside");
  assert.equal(rows[0].outcome, "would nudge");
  assert.match(notes[0], /Couldn't list collaborators \(403/);
});

test("a change request from a private org member with push access counts", () => {
  const pr = basePr({
    timelineItems: {
      nodes: [
        {
          __typename: "PullRequestReview",
          state: "CHANGES_REQUESTED",
          author: { login: "BigGillyStyle", __typename: "User" },
          authorAssociation: "CONTRIBUTOR",
          submittedAt: at(1),
        },
      ],
    },
  });
  assert.equal(run(pr, 30).why, "not author's turn");
  const facts = summarize(pr, ["ci"], null, new Set(["BigGillyStyle"]));
  assert.equal(decide(facts, T0 + 8.1 * DAY).action, "nudge");
});

test("a push counts from when CI started on it, not the commit's local date", () => {
  // A bot thread from day 1; a commit made on day 2 but pushed on day 9.5.
  const pr = withContexts([
    {
      __typename: "CheckRun",
      name: "ci",
      conclusion: "SUCCESS",
      startedAt: at(9.5),
      completedAt: at(9.6),
    },
  ]);
  pr.reviewThreads = { nodes: [thread("coderabbitai", 1)] };
  pr.timelineItems = {
    nodes: [
      { __typename: "PullRequestCommit", commit: { committedDate: at(2) } },
    ],
  };
  const decision = run(pr, 10);
  assert.equal(decision.action, "none");
  assert.equal(decision.clockStart, T0 + 9.5 * DAY);
});
