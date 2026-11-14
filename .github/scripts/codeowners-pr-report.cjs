"use strict";

/**
 * Formatter for .github/workflows/codeowners-pr-report.yml.
 *
 * Turns the board from `scripts/pr-triage.sh --json` and the author's-turn
 * facts from pr-author-nudge.cjs's `collectFacts()` into the Codeowners PR
 * Report, a Slack Block Kit message. It lists only PRs a codeowner can act on
 * today:
 *
 *   🙋 nobody has claimed it (no codeowner assigned besides its author), or
 *      it is claimed but pr-review-inline hasn't run yet
 *   🧪 claimed, needs pr-local-test
 *   ✅ claimed, needs final review, approval and merge
 *   💬 the author replied in every open thread and waits on a reviewer
 *
 * A PR that is its author's turn under pr-author-nudge.cjs is in no list, so
 * the report and the author reminders never disagree. An exempt PR (ghost or
 * bot author, `keep-open` label) is listed even then: the nudge never
 * reminds anyone about it. The 🟢🟡🔴 light is how
 * long the PR has been the codeowners' turn, against the author nudge's own
 * thresholds: 🟡 from the day an author would be nudged, 🔴 from the day
 * they'd be closed.
 *
 * `buildReport()` and the formatters are pure; `assembleReport()` reads GitHub
 * and is shared with the Security Advisory Report, so both reports pick
 * and format PRs the same way.
 */

const {
  DAYS,
  DAY_MS,
  slackEscape,
  collectFacts,
} = require("./pr-author-nudge.cjs");

// Per list, so one long list can't push the others past Slack's limits.
const MAX_LINES = 15;
// A section's mrkdwn text is capped at 3000 characters.
const MAX_SECTION_CHARS = 2900;
const TITLE_CHARS = 60;
const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
const SLACK_ID = /^[UW][A-Z0-9]+$/;

const LISTS = [
  ["owner", "🙋 Needs a codeowner (run `/pr-review-inline`)"],
  ["local", "🧪 Needs `/pr-local-test`"],
  ["final", "✅ Needs final review, approval and merge"],
  ["reply", "💬 Reviewer needs to reply"],
];
const LIGHTS = ["🟢", "🟡", "🔴"];
// The next step on an unclaimed PR that is past pr-review-inline.
const NEXT_STEP = {
  LOCAL: "next: `/pr-local-test`",
  MANUAL: "next: final review",
  MERGE: "approved, needs merge",
};

const lower = (login) => String(login ?? "").toLowerCase();
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function shorten(title) {
  const flat = String(title ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > TITLE_CHARS
    ? `${flat.slice(0, TITLE_CHARS - 1).trimEnd()}…`
    : flat;
}

/**
 * A Slack link whose text is `ref` and the shortened title, both escaped.
 * `url` must be one this code built or validated.
 */
const slackLink = (url, ref, title) =>
  `<${url}|${slackEscape(ref)} ${slackEscape(shorten(title))}>`;

/**
 * Parses the CODEOWNERS_SLACK_IDS repository variable: JSON mapping GitHub
 * login to Slack member ID. Returns `{ ids, warning }`; a bad value gives an
 * empty map and a warning, so the report still goes out without pings.
 */
function parseSlackIds(raw) {
  if (!raw || !raw.trim()) return { ids: new Map(), warning: null };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ids: new Map(),
      warning: `CODEOWNERS_SLACK_IDS isn't valid JSON (${error.message}); nobody is mentioned.`,
    };
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ids: new Map(),
      warning:
        "CODEOWNERS_SLACK_IDS must be a JSON object of login to Slack ID; nobody is mentioned.",
    };
  }
  const ids = new Map();
  const bad = [];
  for (const [login, id] of Object.entries(parsed)) {
    if (typeof id === "string" && SLACK_ID.test(id)) ids.set(lower(login), id);
    else bad.push(login);
  }
  return {
    ids,
    warning: bad.length
      ? `CODEOWNERS_SLACK_IDS has invalid Slack IDs for ${bad.join(", ")}; they aren't mentioned.`
      : null,
  };
}

/** A Slack mention for a mapped login, otherwise plain text that pings no one. */
const mention = (login, slackIds) => {
  const id = slackIds.get(lower(login));
  return id ? `<@${id}>` : `@${slackEscape(login)}`;
};

/** 0 green, 1 yellow, 2 red. */
function lightFor(ageDays, tier) {
  const days = DAYS[tier] ?? DAYS.outside;
  if (ageDays >= days.close) return 2;
  if (ageDays >= days.nudge) return 1;
  return 0;
}

/** Which list a PR goes in, and the details for its line; null for none. */
function place(pr, facts, codeowners, slackIds) {
  // OWN is the triage viewer's own finished PR; the workflow's viewer is a
  // bot, but a local run can still produce it.
  const bucket =
    pr.bucket === "OWN" ? (pr.approved ? "MERGE" : "MANUAL") : pr.bucket;
  if (!["INLINE", "LOCAL", "MANUAL", "MERGE", "REPLY"].includes(bucket))
    return null;
  // The author's turn hides a PR only when the nudge will remind them; an
  // exempt PR (ghost, bot, keep-open) has nobody else to move it.
  if (facts.reasons?.length && !facts.exempt) return null;

  const claimers = pr.codeownerAssignees ?? [];
  const claimed = claimers.length > 0;
  const mentions = (logins) =>
    logins.map((l) => mention(l, slackIds)).join(" ");
  const author = mention(pr.author, slackIds);
  // The held local-test result, without the triage note's bot details.
  const held = (pr.note ?? "")
    .split("; ")
    .filter((part) => part.startsWith("last local test"));

  if (bucket === "REPLY") {
    const owners = new Set(codeowners.map(lower));
    const openers = (pr.threadOpeners ?? []).filter(
      (l) => owners.has(lower(l)) && lower(l) !== lower(pr.author),
    );
    const who = openers.length ? openers : claimers;
    return {
      list: "reply",
      details: [
        plural(pr.unresolvedThreads ?? 0, "thread"),
        who.length ? mentions(who) : "no codeowner assigned",
      ],
    };
  }
  if (!claimed) {
    const outside = pr.tier === "outside" ? " (outside contributor)" : "";
    return {
      list: "owner",
      details: [
        `by ${author}${outside}`,
        ...(NEXT_STEP[bucket] ? [NEXT_STEP[bucket]] : []),
        ...held,
      ],
    };
  }
  if (bucket === "INLINE") {
    return {
      list: "owner",
      details: [
        `by ${author}`,
        `claimed by ${mentions(claimers)}, review not run yet`,
      ],
    };
  }
  if (bucket === "LOCAL") {
    return { list: "local", details: [mentions(claimers), ...held] };
  }
  const approved = bucket === "MERGE";
  return {
    list: "final",
    details: [
      ...(pr.authorIsCodeowner ? [`by ${author}`] : []),
      mentions(claimers),
      ...(approved
        ? ["approved, needs merge"]
        : pr.authorIsCodeowner
          ? ["needs a different codeowner to approve"]
          : []),
    ],
  };
}

/**
 * One list as a Block Kit section: its heading and count, then a bullet per
 * line, cut to fit Slack's limits with an "…and N more" line.
 */
function listSection(heading, entries) {
  const lines = [`*${heading}* · ${entries.length}`];
  let length = lines[0].length;
  let shown = 0;
  for (const entry of entries) {
    const line = `• ${entry}`;
    // Room is kept for the "…and N more" line.
    if (shown === MAX_LINES || length + line.length + 40 > MAX_SECTION_CHARS)
      break;
    lines.push(line);
    length += line.length + 1;
    shown += 1;
  }
  if (shown < entries.length) lines.push(`…and ${entries.length - shown} more`);
  return { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } };
}

/**
 * One list as Block Kit sections with every line in them: past Slack's
 * section limit, the list continues in another section under the same
 * heading.
 */
function fullListSections(heading, entries) {
  const sections = [];
  let lines = [`*${heading}* · ${entries.length}`];
  let length = lines[0].length;
  for (const entry of entries) {
    const line = `• ${entry}`;
    if (lines.length > 1 && length + line.length + 1 > MAX_SECTION_CHARS) {
      sections.push(lines.join("\n"));
      lines = [`*${heading}* (continued)`];
      length = lines[0].length;
    }
    lines.push(line);
    length += line.length + 1;
  }
  sections.push(lines.join("\n"));
  return sections.map((text) => ({
    type: "section",
    text: { type: "mrkdwn", text },
  }));
}

/**
 * Whether the report lists a board PR, given its `summarize()` facts: false
 * for a PR that is its author's turn, a draft, or in a stage a codeowner
 * can't act on yet.
 */
const isListed = (pr, facts) =>
  Boolean(facts) &&
  PR_URL.test(pr.url ?? "") &&
  place({ ...pr, tier: facts.tier }, facts, [], new Map()) !== null;

/**
 * Builds the report. `board` is pr-triage's JSON, `factsByUrl` a Map of PR URL
 * to `summarize()` facts (URLs, because PRs from several repos can share a
 * number). Options: `now` (ms), `slackIds` (Map of lowercase login to Slack
 * ID), `runUrl` (the workflow run), `warnings` (strings shown as ⚠️ sections,
 * for data the report had to do without), and the wording that names the
 * report: `title`, `emptyText` and `boardHint` (the context line's first
 * item). A board PR's optional `ref` replaces `#<number>` in its link.
 * `extraLists` (`[{ heading, lines }]`, lines already in Slack mrkdwn) follow
 * the PR lists in the same layout, with no line cap (a long one continues in
 * further sections), and `headerExtras` (strings) end the header.
 * `capLists: false` lifts the PR lists' line cap the same way. Returns
 * `{ text, blocks, counts }`: the notification fallback, the Block Kit
 * blocks, and `{ listed, red, yellow }`.
 */
function buildReport(
  board,
  factsByUrl,
  {
    now,
    slackIds = new Map(),
    runUrl,
    warnings = [],
    title = "Codeowners PR Report",
    emptyText = "Nothing is waiting on codeowners today.",
    boardHint = "Full board: `pnpm pr:triage:html`",
    extraLists = [],
    headerExtras = [],
    capLists = true,
  },
) {
  const codeowners = board.codeowners ?? [];
  const lists = Object.fromEntries(LISTS.map(([key]) => [key, []]));

  for (const pr of board.prs ?? []) {
    if (!PR_URL.test(pr.url ?? "")) continue;
    const facts = factsByUrl.get(pr.url);
    // Facts are fetched after the board, so a board PR without facts closed
    // in between.
    if (!facts) continue;
    const tier = facts.tier;
    const placed = place({ ...pr, tier }, facts, codeowners, slackIds);
    if (!placed) continue;
    const since = Date.parse(pr.turnSince);
    const ageDays = Number.isNaN(since)
      ? 0
      : Math.max(0, (now - since) / DAY_MS);
    const light = lightFor(ageDays, tier);
    const link = slackLink(pr.url, pr.ref ?? `#${pr.number}`, pr.title);
    lists[placed.list].push({
      light,
      since,
      line: [
        `${LIGHTS[light]} ${link}`,
        ...placed.details,
        `${Math.floor(ageDays)}d`,
      ].join(" · "),
    });
  }

  const all = Object.values(lists).flat();
  const counts = {
    listed: all.length,
    red: all.filter((e) => e.light === 2).length,
    yellow: all.filter((e) => e.light === 1).length,
  };

  const warning = [
    ...(board.truncated
      ? [
          `There are more open PRs than triage fetched; only the oldest ${board.fetched} were checked.`,
        ]
      : []),
    ...warnings.map(slackEscape),
  ].map((text) => ({
    type: "section",
    text: { type: "mrkdwn", text: `⚠️ ${text}` },
  }));
  const context = {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: [
          boardHint,
          ...(runUrl ? [`<${runUrl}|workflow run>`] : []),
          "reply in this thread to take a PR or ask for help",
        ].join(" · "),
      },
    ],
  };

  const extras = extraLists.filter((list) => list.lines.length);
  if (!counts.listed && !extras.length) {
    const text = emptyText;
    return {
      text,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text } },
        ...warning,
        context,
      ],
      counts,
    };
  }

  const date = new Date(now)
    .toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "America/Chicago",
    })
    .replace(",", "");
  const need = `${plural(counts.listed, "PR")} ${counts.listed === 1 ? "needs" : "need"} a codeowner`;
  const summary = [`🔴 ${counts.red} 🟡 ${counts.yellow}`, ...headerExtras];
  const header = `${title} · ${date} · ${need} · ${summary.join(" · ")}`;

  const sections = [];
  for (const [key, heading] of LISTS) {
    const entries = lists[key].sort(
      (a, b) => b.light - a.light || (a.since || 0) - (b.since || 0),
    );
    if (!entries.length) continue;
    const lines = entries.map((e) => e.line);
    if (capLists) sections.push(listSection(heading, lines));
    else sections.push(...fullListSections(heading, lines));
  }
  // Uncapped: an extra list must name every entry.
  for (const { heading, lines } of extras)
    sections.push(...fullListSections(heading, lines));

  return {
    text: `${title}: ${need} (${summary.join(", ")})`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: header, emoji: true },
      },
      ...warning,
      ...sections,
      context,
    ],
    counts,
  };
}

/**
 * Reads whose turn each PR is for every board, then builds the report.
 * `sources` is `[{ owner, repo, board, base? }]`: pr-triage's JSON for each
 * repo, and where its branch rules and team live (see `collectFacts()`).
 * `slackIdsRaw` is the CODEOWNERS_SLACK_IDS value. `extraLists`,
 * `headerExtras` and `boardHint`, when functions, get
 * `(board, factsByUrl, slackIds)` for the merged board and return
 * `buildReport()`'s option of that name. Other options pass through to
 * `buildReport()`. Returns `{ report, notes }`, where `notes` are
 * the warnings, each once, which the report also shows.
 */
async function assembleReport({
  github,
  sources,
  slackIdsRaw,
  warnings = [],
  extraLists = [],
  headerExtras = [],
  boardHint,
  ...options
}) {
  const notes = [...warnings];
  const factsByUrl = new Map();
  const prs = [];
  let truncated = false;
  let fetched = 0;
  for (const { owner, repo, board, base } of sources) {
    const collected = await collectFacts({ github, owner, repo, base });
    notes.push(...collected.notes);
    for (const pr of collected.prs)
      factsByUrl.set(pr.url, collected.factsFor(pr));
    prs.push(...(board.prs ?? []));
    truncated ||= Boolean(board.truncated);
    fetched += board.fetched ?? 0;
  }
  const { ids, warning } = parseSlackIds(slackIdsRaw);
  if (warning) notes.push(warning);
  // Sources that share a base repo report its access problems once each.
  const uniqueNotes = [...new Set(notes)];
  const board = {
    codeowners: sources[0]?.board.codeowners ?? [],
    truncated,
    fetched,
    prs,
  };
  const resolve = (option) =>
    typeof option === "function" ? option(board, factsByUrl, ids) : option;
  return {
    report: buildReport(board, factsByUrl, {
      ...options,
      extraLists: resolve(extraLists),
      headerExtras: resolve(headerExtras),
      // Left out when unset, so buildReport()'s default applies.
      ...(boardHint === undefined ? {} : { boardHint: resolve(boardHint) }),
      slackIds: ids,
      warnings: uniqueNotes,
    }),
    notes: uniqueNotes,
  };
}

// Brackets in a title would end the link text early and let the title start
// a link of its own. GitHub honors backslash escapes.
const escapeBrackets = (label) => label.replace(/[\\[\]]/g, "\\$&");

/**
 * The message as Markdown. `lineBreak` ends each line inside a section:
 * GitHub's job summary needs a hard break ("  \n"); Slack's Markdown input
 * takes a plain newline. `safeLabel` defuses brackets in link text.
 */
function toMarkdown(
  { blocks },
  { lineBreak = "  \n", safeLabel = escapeBrackets } = {},
) {
  return blocks
    .map((block) => {
      if (block.type === "header") return `### ${block.text.text}`;
      const text =
        block.type === "context"
          ? block.elements.map((e) => e.text).join(" ")
          : block.text.text;
      return text
        .replace(
          /<(https:[^|>]+)\|([^>]+)>/g,
          (_, url, label) => `[${safeLabel(label)}](${url})`,
        )
        .replace(/^\*(.+?)\*/gm, "**$1**")
        .replace(/\n/g, lineBreak);
    })
    .join("\n\n");
}

// "@here", "@channel" and "@everyone" in a title or a GitHub login (a user
// can be named "here") must not notify a whole channel.
const BROADCAST = /@(here|channel|everyone)\b/gi;

/**
 * The message as Markdown for an agent's Slack tool, which posts as the
 * person running it and takes Markdown, not Block Kit. Same text as the
 * Block Kit message, except that brackets in link text become parentheses
 * (Slack's Markdown escapes aren't documented) and a zero-width space defuses
 * broadcast mentions.
 */
function toSlackMarkdown(report) {
  return toMarkdown(report, {
    lineBreak: "\n",
    safeLabel: (label) => label.replace(/\[/g, "(").replace(/\]/g, ")"),
  }).replace(BROADCAST, "@\u200b$1");
}

module.exports = {
  MAX_LINES,
  parseSlackIds,
  mention,
  lightFor,
  buildReport,
  isListed,
  slackLink,
  assembleReport,
  toMarkdown,
  toSlackMarkdown,
};
