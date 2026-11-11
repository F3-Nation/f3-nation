"use strict";

// Run with: node --test .github/scripts/codeowners-pr-report.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_LINES,
  parseSlackIds,
  lightFor,
  buildReport,
  isListed,
  assembleReport,
  toMarkdown,
  toSlackMarkdown,
} = require("./codeowners-pr-report.cjs");
const { DAYS } = require("./pr-author-nudge.cjs");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-04T14:07:00Z");
const ago = (days) => new Date(NOW - days * DAY).toISOString();

const pr = (number, overrides = {}) => ({
  bucket: "INLINE",
  number,
  title: `feat(api): change ${number}`,
  url: `https://github.com/F3-Nation/f3-nation/pull/${number}`,
  author: "amy",
  authorAssociation: "COLLABORATOR",
  authorIsCodeowner: false,
  assignees: [],
  codeownerAssignees: [],
  unresolvedThreads: 0,
  threadOpeners: [],
  approved: false,
  turnSince: ago(1),
  note: "",
  ...overrides,
});
const teamFacts = { tier: "team", reasons: [] };

/** Builds a report from PRs; facts default to "not the author's turn", team. */
function report(
  prs,
  { facts = {}, slackIds, truncated = false, warnings } = {},
) {
  const factsByUrl = new Map(
    prs.map((p) => [p.url, facts[p.number] ?? teamFacts]),
  );
  return buildReport(
    {
      codeowners: ["andy", "dan", "luis"],
      truncated,
      fetched: prs.length,
      prs,
    },
    factsByUrl,
    {
      now: NOW,
      slackIds:
        slackIds ?? parseSlackIds('{"Andy":"U0ANDY","dan":"U0DAN"}').ids,
      runUrl: "https://github.com/F3-Nation/f3-nation/actions/runs/1",
      warnings,
    },
  );
}

/** The section text for one list, found by its emoji, or undefined. */
function list(result, emoji) {
  return result.blocks.find(
    (b) => b.type === "section" && b.text.text.startsWith(`*${emoji}`),
  )?.text.text;
}
const lineFor = (text, number) =>
  text?.split("\n").find((l) => l.includes(`|#${number} `));

test("unclaimed PRs go to 🙋, however they are assigned", () => {
  const result = report([
    pr(1),
    pr(2, { assignees: ["amy"] }),
    pr(3, { assignees: ["drive-by"] }),
    pr(4, {
      author: "andy",
      authorIsCodeowner: true,
      assignees: ["andy"],
      bucket: "MANUAL",
    }),
  ]);
  const owner = list(result, "🙋");
  for (const n of [1, 2, 3, 4]) assert.ok(lineFor(owner, n), `#${n} in 🙋`);
  assert.equal(list(result, "✅"), undefined);
});

test("🙋 names the next step past pr-review-inline and pings nobody", () => {
  const owner = list(
    report([pr(1, { bucket: "LOCAL" }), pr(2, { bucket: "MERGE" })]),
    "🙋",
  );
  assert.match(lineFor(owner, 1), /by amy · next: `\/pr-local-test`/);
  assert.match(lineFor(owner, 2), /approved, needs merge/);
  assert.doesNotMatch(owner, /<@/);
});

test("an unclaimed PR held after a local test shows the held result", () => {
  const owner = list(
    report([
      pr(1, {
        bucket: "LOCAL",
        note: "last local test could not recommend yet; merge conflicts",
      }),
    ]),
    "🙋",
  );
  assert.match(
    lineFor(owner, 1),
    /next: `\/pr-local-test` · last local test could not recommend yet · 1d$/,
  );
});

test("the triage viewer's own PR is judged like anyone else's", () => {
  const result = report([
    pr(1, { bucket: "OWN", approved: true, codeownerAssignees: ["dan"] }),
    pr(2, { bucket: "OWN", approved: false, codeownerAssignees: ["dan"] }),
  ]);
  const final = list(result, "✅");
  assert.match(lineFor(final, 1), /approved, needs merge/);
  assert.doesNotMatch(lineFor(final, 2), /approved/);
});

test("🙋 marks outside contributors", () => {
  const owner = list(
    report([pr(1)], { facts: { 1: { tier: "outside", reasons: [] } } }),
    "🙋",
  );
  assert.match(lineFor(owner, 1), /by amy \(outside contributor\)/);
});

test("claimed but not reviewed stays in 🙋 as review not run yet", () => {
  const owner = list(report([pr(1, { codeownerAssignees: ["dan"] })]), "🙋");
  assert.match(lineFor(owner, 1), /claimed by @dan, review not run yet/);
  assert.doesNotMatch(owner, /<@U0DAN>/);
});

test("claimed and LOCAL goes to 🧪, mentioning the claimer and the held result", () => {
  const local = list(
    report([
      pr(1, {
        bucket: "LOCAL",
        codeownerAssignees: ["dan"],
        note: "last local test said don't approve yet; gave up waiting on Qodo",
      }),
    ]),
    "🧪",
  );
  const line = lineFor(local, 1);
  assert.match(line, /<@U0DAN> · last local test said don't approve yet · 1d$/);
  assert.doesNotMatch(line, /Qodo/);
});

test("claimed and MANUAL goes to ✅", () => {
  const final = list(
    report([pr(1, { bucket: "MANUAL", codeownerAssignees: ["andy"] })]),
    "✅",
  );
  assert.match(lineFor(final, 1), /<@U0ANDY> · 1d$/);
});

test("MERGE is approved, needs merge", () => {
  const final = list(
    report([pr(1, { bucket: "MERGE", codeownerAssignees: ["andy"] })]),
    "✅",
  );
  assert.match(lineFor(final, 1), /<@U0ANDY> · approved, needs merge/);
});

test("a codeowner's own PR needs a different codeowner to approve", () => {
  const final = list(
    report([
      pr(1, {
        bucket: "MANUAL",
        author: "luis",
        authorIsCodeowner: true,
        codeownerAssignees: ["dan"],
      }),
    ]),
    "✅",
  );
  assert.match(
    lineFor(final, 1),
    /by luis · <@U0DAN> · needs a different codeowner to approve/,
  );
});

test("REPLY goes to 💬, mentioning the codeowners who opened the threads", () => {
  const reply = list(
    report([
      pr(1, {
        bucket: "REPLY",
        unresolvedThreads: 3,
        threadOpeners: ["coderabbitai", "Andy", "dan"],
        codeownerAssignees: ["luis"],
      }),
    ]),
    "💬",
  );
  assert.match(reply, /^\*💬 Reviewer needs to reply\*/);
  assert.match(lineFor(reply, 1), /· 3 threads · <@U0ANDY> <@U0DAN> · 1d$/);
});

test("💬 falls back to the claiming codeowner when a bot opened the threads", () => {
  const reply = list(
    report([
      pr(1, {
        bucket: "REPLY",
        unresolvedThreads: 1,
        threadOpeners: ["coderabbitai"],
        codeownerAssignees: ["dan"],
      }),
    ]),
    "💬",
  );
  assert.match(lineFor(reply, 1), /· 1 thread · <@U0DAN> ·/);
});

test("an unclaimed REPLY with bot-opened threads still goes to 💬", () => {
  const result = report([
    pr(1, {
      bucket: "REPLY",
      unresolvedThreads: 2,
      threadOpeners: ["coderabbitai"],
    }),
  ]);
  assert.equal(list(result, "🙋"), undefined);
  assert.match(
    lineFor(list(result, "💬"), 1),
    /> · 2 threads · no codeowner assigned · 1d$/,
  );
});

test("PRs that are the author's turn are in no list", () => {
  const result = report(
    [
      pr(1, { bucket: "MANUAL", codeownerAssignees: ["dan"] }),
      pr(2, { bucket: "LOCAL" }),
      pr(3, { bucket: "REPLY", unresolvedThreads: 1 }),
    ],
    {
      facts: {
        1: { tier: "team", reasons: [{ kind: "conflict" }] },
        2: { tier: "team", reasons: [{ kind: "checks" }] },
        3: { tier: "team", reasons: [{ kind: "draft" }] },
      },
    },
  );
  assert.equal(result.counts.listed, 0);
  assert.equal(result.text, "Nothing is waiting on codeowners today.");
});

test("an exempt PR is listed even when it is the author's turn", () => {
  const final = list(
    report([pr(1, { bucket: "MANUAL", codeownerAssignees: ["dan"] })], {
      facts: {
        1: { tier: "team", exempt: true, reasons: [{ kind: "conflict" }] },
      },
    }),
    "✅",
  );
  assert.match(lineFor(final, 1), /<@U0DAN> · 1d$/);
});

test("buckets that aren't the codeowners' turn are left out", () => {
  const result = report(
    ["BOTS", "THREADS", "DRAFT", "SKIP"].map((bucket, i) =>
      pr(i + 1, { bucket }),
    ),
  );
  assert.equal(result.counts.listed, 0);
});

test("the light follows the author nudge's DAYS for the author's tier", () => {
  assert.deepEqual(DAYS, {
    team: { nudge: 5, close: 10 },
    outside: { nudge: 3, close: 7 },
  });
  assert.equal(lightFor(4.9, "team"), 0);
  assert.equal(lightFor(5, "team"), 1);
  assert.equal(lightFor(9.9, "team"), 1);
  assert.equal(lightFor(10, "team"), 2);
  assert.equal(lightFor(2.9, "outside"), 0);
  assert.equal(lightFor(3, "outside"), 1);
  assert.equal(lightFor(7, "outside"), 2);
});

test("the light uses turnSince, and the tier from the facts", () => {
  const result = report(
    [
      pr(1, { turnSince: ago(4.9) }),
      pr(2, { turnSince: ago(5) }),
      pr(3, { turnSince: ago(3) }),
    ],
    { facts: { 3: { tier: "outside", reasons: [] } } },
  );
  const owner = list(result, "🙋");
  assert.match(lineFor(owner, 1), /^• 🟢 /);
  assert.match(lineFor(owner, 2), /^• 🟡 /);
  assert.match(lineFor(owner, 3), /^• 🟡 /);
  assert.equal(result.counts.yellow, 2);
});

test("a board PR without facts closed after triage and is left out", () => {
  const result = buildReport(
    { codeowners: [], prs: [pr(1, { bucket: "MANUAL" })] },
    new Map(),
    { now: NOW },
  );
  assert.equal(result.counts.listed, 0);
});

test("lists sort red first, then oldest first", () => {
  const owner = list(
    report([
      pr(1, { turnSince: ago(1) }),
      pr(2, { turnSince: ago(11) }),
      pr(3, { turnSince: ago(2) }),
      pr(4, { turnSince: ago(6) }),
    ]),
    "🙋",
  );
  const order = owner
    .split("\n")
    .slice(1)
    .map((l) => l.match(/\|#(\d+) /)[1]);
  assert.deepEqual(order, ["2", "4", "3", "1"]);
});

test("mentions map case-insensitively and leave unmapped logins as text", () => {
  const { ids, warning } = parseSlackIds('{"BigGillyStyle":"U0ANDY"}');
  assert.equal(warning, null);
  const final = list(
    report(
      [
        pr(1, { bucket: "MANUAL", codeownerAssignees: ["biggillystyle"] }),
        pr(2, { bucket: "MANUAL", codeownerAssignees: ["taterhead247"] }),
      ],
      { slackIds: ids },
    ),
    "✅",
  );
  assert.match(lineFor(final, 1), /<@U0ANDY>/);
  assert.match(lineFor(final, 2), / @taterhead247 /);
});

test("a bad CODEOWNERS_SLACK_IDS warns and mentions nobody", () => {
  for (const raw of ["{nope", "[]", '"U1"']) {
    const { ids, warning } = parseSlackIds(raw);
    assert.equal(ids.size, 0);
    assert.match(warning, /CODEOWNERS_SLACK_IDS/);
  }
  const { ids, warning } = parseSlackIds('{"amy":"<!channel>","dan":"U0DAN"}');
  assert.deepEqual([...ids], [["dan", "U0DAN"]]);
  assert.match(warning, /amy/);
  assert.equal(parseSlackIds(undefined).warning, null);
});

test("every PR line opens with the light and one link over number and title", () => {
  const result = report([
    pr(1),
    pr(2, { bucket: "LOCAL", codeownerAssignees: ["dan"] }),
    pr(3, { bucket: "MANUAL", codeownerAssignees: ["dan"] }),
    pr(4, { bucket: "REPLY", unresolvedThreads: 1 }),
  ]);
  for (const n of [1, 2, 3, 4]) {
    const line = result.blocks
      .filter((b) => b.type === "section")
      .map((b) => lineFor(b.text.text, n))
      .find(Boolean);
    assert.match(
      line,
      new RegExp(
        `^• 🟢 <https://github\\.com/F3-Nation/f3-nation/pull/${n}\\|#${n} feat\\(api\\): change ${n}> · `,
      ),
    );
  }
});

test("long titles are shortened inside the link", () => {
  const owner = list(report([pr(1, { title: "x".repeat(100) })]), "🙋");
  assert.match(lineFor(owner, 1), new RegExp(`\\|#1 ${"x".repeat(59)}…> `));
});

test("a hostile title or login is escaped, including inside the link", () => {
  const result = report([
    pr(1, {
      title: "<!channel> & <https://evil.example|click>",
      author: "<!here>",
    }),
  ]);
  const line = lineFor(list(result, "🙋"), 1);
  assert.match(
    line,
    /\|#1 &lt;!channel&gt; &amp; &lt;https:\/\/evil\.example\|click&gt;> · by &lt;!here&gt; ·/,
  );
  assert.equal((line.match(/</g) ?? []).length, 1);
});

test("a PR whose url isn't a GitHub PR link is dropped", () => {
  const result = report([pr(1, { url: "https://evil.example/|x" })]);
  assert.equal(result.counts.listed, 0);
});

test("all lists empty is one line, then the context with the run link", () => {
  const result = report([]);
  assert.deepEqual(result.blocks.slice(0, -1), [
    {
      type: "section",
      text: { type: "mrkdwn", text: "Nothing is waiting on codeowners today." },
    },
  ]);
  const context = result.blocks.at(-1);
  assert.equal(context.type, "context");
  assert.match(
    context.elements[0].text,
    /<https:\/\/github\.com\/F3-Nation\/f3-nation\/actions\/runs\/1\|workflow run>/,
  );
});

test("past the cap a list says how many more there are", () => {
  const prs = Array.from({ length: MAX_LINES + 3 }, (_, i) => pr(i + 1));
  const owner = list(report(prs), "🙋");
  assert.equal(
    owner.split("\n").filter((l) => l.startsWith("• ")).length,
    MAX_LINES,
  );
  assert.match(owner, /\n…and 3 more$/);
  assert.match(owner, new RegExp(`^\\*🙋 .*\\* · ${MAX_LINES + 3}\\n`));
});

test("long lines stay under Slack's section limit", () => {
  const prs = Array.from({ length: MAX_LINES }, (_, i) =>
    pr(i + 1, {
      bucket: "MANUAL",
      codeownerAssignees: Array.from(
        { length: 10 },
        (_, j) => `codeowner-${j}`,
      ),
      title: "y".repeat(200),
    }),
  );
  const final = list(report(prs, { slackIds: new Map() }), "✅");
  assert.ok(final.length <= 3000, `${final.length} chars`);
  assert.match(final, /…and \d+ more$/);
});

test("the header counts PRs and lights, and the context links the run", () => {
  const result = report([
    pr(1, { turnSince: ago(11) }),
    pr(2, { turnSince: ago(6) }),
    pr(3, { bucket: "LOCAL", codeownerAssignees: ["dan"] }),
  ]);
  assert.deepEqual(result.blocks[0], {
    type: "header",
    text: {
      type: "plain_text",
      text: "Codeowners PR Report · Wed Nov 4 · 3 PRs need a codeowner · 🔴 1 🟡 1",
      emoji: true,
    },
  });
  assert.equal(result.blocks.filter((b) => b.type === "section").length, 2);
  const context = result.blocks.at(-1);
  assert.equal(context.type, "context");
  assert.match(
    context.elements[0].text,
    /<https:\/\/github\.com\/F3-Nation\/f3-nation\/actions\/runs\/1\|workflow run>/,
  );
  assert.match(result.text, /3 PRs need a codeowner \(🔴 1 🟡 1\)/);
});

test("a cut-off triage list adds a warning", () => {
  const result = report([pr(1)], { truncated: true });
  assert.match(result.blocks[1].text.text, /^⚠️ There are more open PRs/);
  assert.match(report([], { truncated: true }).blocks[1].text.text, /^⚠️/);
});

test("each warning is its own ⚠️ section, escaped, even with no PRs listed", () => {
  const warnings = ["Couldn't list collaborators (403 <nope>)", "second"];
  for (const result of [
    report([pr(1)], { warnings }),
    report([], { warnings }),
  ]) {
    const texts = result.blocks
      .filter((b) => b.type === "section")
      .map((b) => b.text.text)
      .filter((t) => t.startsWith("⚠️"));
    assert.deepEqual(texts, [
      "⚠️ Couldn't list collaborators (403 &lt;nope&gt;)",
      "⚠️ second",
    ]);
  }
});

test("the job summary renders the links as Markdown", () => {
  const markdown = toMarkdown(report([pr(1)]));
  assert.match(markdown, /^### Codeowners PR Report/);
  assert.match(
    markdown,
    /\[#1 feat\(api\): change 1\]\(https:\/\/github\.com\/F3-Nation\/f3-nation\/pull\/1\)/,
  );
  assert.match(markdown, /\*\*🙋 Needs a codeowner/);
});

test("a title can't start a link of its own in the job summary", () => {
  const markdown = toMarkdown(
    report([pr(1, { title: "](https://phish.example) [x" })]),
  );
  assert.match(
    markdown,
    /\[#1 \\\]\(https:\/\/phish\.example\) \\\[x\]\(https:\/\/github\.com\/F3-Nation\/f3-nation\/pull\/1\)/,
  );
});

test("PRs from different repos with the same number are kept apart", () => {
  const forkPr = pr(1, {
    url: "https://github.com/F3-Nation/f3-nation-ghsa-aaaa-bbbb-cccc/pull/1",
    ref: "GHSA-aaaa-bbbb-cccc #1",
  });
  const result = buildReport(
    { codeowners: [], prs: [pr(1), forkPr] },
    new Map([
      [pr(1).url, teamFacts],
      [forkPr.url, { tier: "team", reasons: [{ kind: "threads" }] }],
    ]),
    { now: NOW },
  );
  // Only the fork PR is its author's turn; each PR got its own facts.
  assert.equal(result.counts.listed, 1);
  assert.match(list(result, "🙋"), /\|#1 feat/);
});

test("a PR's ref replaces its number in the link", () => {
  const owner = list(report([pr(1, { ref: "GHSA-aaaa-bbbb-cccc #1" })]), "🙋");
  assert.match(owner, /\|GHSA-aaaa-bbbb-cccc #1 feat\(api\): change 1>/);
});

test("the report's name, empty text and board hint can be changed", () => {
  const named = buildReport(
    { codeowners: [], prs: [pr(1)] },
    new Map([[pr(1).url, teamFacts]]),
    {
      now: NOW,
      title: "Security Advisory PR Report",
      boardHint: "Run by @andy",
    },
  );
  assert.match(named.blocks[0].text.text, /^Security Advisory PR Report · /);
  assert.match(named.text, /^Security Advisory PR Report: 1 PR needs/);
  assert.match(named.blocks.at(-1).elements[0].text, /^Run by @andy · /);
  const empty = buildReport({ codeowners: [], prs: [] }, new Map(), {
    now: NOW,
    emptyText: "No security advisory PRs are waiting.",
  });
  assert.equal(empty.text, "No security advisory PRs are waiting.");
});

test("the Slack Markdown uses plain newlines and defuses broadcasts", () => {
  const markdown = toSlackMarkdown(
    report([pr(1, { title: "@channel [fix](https://x.example)" }), pr(2)]),
  );
  assert.doesNotMatch(markdown, / {2}\n/);
  assert.match(
    markdown,
    /\n• 🟢 \[#1 @\u200bchannel \(fix\)\(https:\/\/x\.example\)\]\(/,
  );
});

test("assembleReport reads facts per repo and merges the boards", async () => {
  const fork = "f3-nation-ghsa-aaaa-bbbb-cccc";
  const calls = [];
  const node = (repo, number, login) => ({
    number,
    url: `https://github.com/F3-Nation/${repo}/pull/${number}`,
    title: "t",
    isDraft: false,
    createdAt: ago(2),
    authorAssociation: "MEMBER",
    author: { login, __typename: "User" },
    timelineItems: { nodes: [] },
    reviewThreads: { nodes: [] },
    commits: { nodes: [] },
  });
  const github = {
    paginate: async (route, params) => {
      calls.push(`${params.repo} ${route}`);
      return [];
    },
    graphql: async (_q, { repo }) => ({
      repository: {
        pullRequests: {
          pageInfo: { hasNextPage: false },
          nodes: [node(repo, 1, "amy")],
        },
      },
    }),
  };
  const boardOf = (repo) => ({
    codeowners: ["andy"],
    fetched: 1,
    prs: [pr(1, { url: `https://github.com/F3-Nation/${repo}/pull/1` })],
  });
  const { report: built, notes } = await assembleReport({
    github,
    sources: [
      { owner: "F3-Nation", repo: "f3-nation", board: boardOf("f3-nation") },
      {
        owner: "F3-Nation",
        repo: fork,
        board: boardOf(fork),
        base: { owner: "F3-Nation", repo: "f3-nation" },
      },
    ],
    slackIdsRaw: "not json",
    now: NOW,
  });
  assert.equal(built.counts.listed, 2);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /CODEOWNERS_SLACK_IDS isn't valid JSON/);
  assert.ok(calls.every((c) => c.startsWith("f3-nation ")));
});

test("extra lists follow the PR lists, and their header notes end the header", () => {
  const result = buildReport(
    { codeowners: [], prs: [pr(1)] },
    new Map([[pr(1).url, teamFacts]]),
    {
      now: NOW,
      extraLists: [
        { heading: "🚧 No open fix PR", lines: ["one", "two"] },
        { heading: "✍️ Empty", lines: [] },
      ],
      headerExtras: ["2 advisories have no open fix PR"],
    },
  );
  assert.match(
    result.blocks[0].text.text,
    / · 1 PR needs a codeowner · 🔴 0 🟡 0 · 2 advisories have no open fix PR$/,
  );
  const texts = result.blocks
    .filter((b) => b.type === "section")
    .map((b) => b.text.text);
  assert.equal(texts.length, 2);
  assert.match(texts[0], /^\*🙋/);
  assert.equal(texts[1], "*🚧 No open fix PR* · 2\n• one\n• two");
});

test("extra lists alone still make a report, not the empty text", () => {
  const result = buildReport({ codeowners: [], prs: [] }, new Map(), {
    now: NOW,
    extraLists: [{ heading: "🚧 No open fix PR", lines: ["one"] }],
  });
  assert.equal(result.blocks[0].type, "header");
  assert.match(result.blocks[0].text.text, / · 0 PRs need a codeowner · /);
});

test("isListed matches what the report lists", () => {
  assert.equal(isListed(pr(1), teamFacts), true);
  assert.equal(
    isListed(pr(1), { tier: "team", reasons: [{ kind: "threads" }] }),
    false,
  );
  assert.equal(isListed(pr(1, { bucket: "THREADS" }), teamFacts), false);
  assert.equal(isListed(pr(1), undefined), false);
});
