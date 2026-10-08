/**
 * Prose columns are replaced, not scrubbed (F3-65). SCRUB only rewrites
 * emails, phones and Slack mentions, so the real names users write into
 * backblasts and descriptions ("Q: Jane Realname, PAX: …") survived it.
 * These columns get deterministic lorem ipsum of about the same length and
 * the same line breaks instead; Slack Block Kit columns keep their block
 * structure with only the prose replaced. Shared by obfuscate-db.ts (which
 * writes it) and obfuscate-db.verify-target.ts (which checks nothing else is
 * left).
 */

/** Every prose column, and how it is stored. */
export const PROSE_COLUMNS: {
  table: string;
  column: string;
  kind: "text" | "rich";
}[] = [
  { table: "public.event_instances", column: "backblast", kind: "text" },
  { table: "public.event_instances", column: "preblast", kind: "text" },
  { table: "public.event_instances", column: "description", kind: "text" },
  { table: "public.event_instances", column: "backblast_rich", kind: "rich" },
  { table: "public.event_instances", column: "preblast_rich", kind: "rich" },
  { table: "public.events", column: "description", kind: "text" },
  { table: "public.locations", column: "description", kind: "text" },
  { table: "public.orgs", column: "description", kind: "text" },
  {
    table: "public.update_requests",
    column: "event_description",
    kind: "text",
  },
  {
    table: "public.update_requests",
    column: "location_description",
    kind: "text",
  },
];

const WORDS = [
  "lorem",
  "ipsum",
  "dolor",
  "sit",
  "amet",
  "consectetur",
  "adipiscing",
  "elit",
  "sed",
  "do",
  "eiusmod",
  "tempor",
  "incididunt",
  "ut",
  "labore",
  "et",
  "dolore",
  "magna",
  "aliqua",
  "enim",
  "ad",
  "minim",
  "veniam",
  "quis",
  "nostrud",
  "exercitation",
  "ullamco",
  "laboris",
  "nisi",
  "aliquip",
  "ex",
  "ea",
  "commodo",
  "consequat",
  "duis",
  "aute",
  "irure",
  "in",
  "reprehenderit",
  "voluptate",
  "velit",
  "esse",
  "cillum",
  "fugiat",
  "nulla",
  "pariatur",
  "excepteur",
  "sint",
  "occaecat",
  "cupidatat",
  "non",
  "proident",
  "sunt",
  "culpa",
  "qui",
  "officia",
  "deserunt",
  "mollit",
  "anim",
  "id",
  "est",
  "laborum",
];
const VOCABULARY = new Set(WORDS);

export type Rng = () => number;

/** mulberry32, seeded from hex (e.g. a salted hash of the row and column). */
export function makeRng(seedHex: string): Rng {
  let a = Number.parseInt(seedHex.slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function word(rng: Rng): string {
  return WORDS[Math.floor(rng() * WORDS.length)] ?? "lorem";
}

/** Lorem ipsum about `length` characters long (at least one word). */
function sentence(rng: Rng, length: number): string {
  const words = [word(rng)];
  let size = words[0]?.length ?? 0;
  while (size < length) {
    const w = word(rng);
    words.push(w);
    size += w.length + 1;
  }
  const first = words[0] ?? "lorem";
  words[0] = first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(" ");
}

/**
 * Line by line: each non-blank line becomes lorem of about its length,
 * keeping its indentation and whether it ended in punctuation; blank lines
 * and the line breaks stay as they were.
 */
export function loremText(value: string, rng: Rng): string {
  return value
    .split("\n")
    .map((line) => {
      const body = line.trim();
      if (body.length === 0) return line;
      const indent = /^\s*/.exec(line)?.[0] ?? "";
      const end = /[.!?:]$/.test(body) ? "." : "";
      return `${indent}${sentence(rng, Math.max(1, body.length - end.length))}${end}`;
    })
    .join("\n");
}

/** Block Kit elements that name a person or place by id. */
const MENTION_TYPES = new Set(["user", "usergroup", "channel"]);

/**
 * Slack Block Kit (a block list, a block, or any part of one): every prose
 * string (a `text` or `alt_text` value) becomes lorem; user / usergroup /
 * channel mentions and links become plain text elements, so no id, name or
 * URL survives; block types, ids, styles and emoji are kept as they are.
 */
export function loremRich(value: unknown, rng: Rng): unknown {
  if (Array.isArray(value)) return value.map((v) => loremRich(v, rng));
  if (value === null || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const type = obj.type;
  if (
    typeof type === "string" &&
    (MENTION_TYPES.has(type) || type === "link")
  ) {
    const text = typeof obj.text === "string" ? obj.text : "x";
    return { type: "text", text: loremText(text, rng) };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] =
      (k === "text" || k === "alt_text") && typeof v === "string"
        ? loremText(v, rng)
        : loremRich(v, rng);
  }
  return out;
}

/** Whether every word in `value` is lorem ipsum. */
export function isLoremText(value: string): boolean {
  for (const m of value.matchAll(/[A-Za-z]+/g)) {
    if (!VOCABULARY.has(m[0].toLowerCase())) return false;
  }
  return true;
}

/** Whether a Block Kit value has only lorem prose and no mention or link. */
export function isLoremRich(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(isLoremRich);
  if (value === null || typeof value !== "object") return true;
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.type === "string" &&
    (MENTION_TYPES.has(obj.type) || obj.type === "link")
  ) {
    return false;
  }
  return Object.entries(obj).every(([k, v]) =>
    (k === "text" || k === "alt_text") && typeof v === "string"
      ? isLoremText(v)
      : isLoremRich(v),
  );
}
