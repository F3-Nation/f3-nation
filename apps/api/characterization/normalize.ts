/**
 * Only headers that are part of the contract. Everything else — dates, content
 * lengths, framework fingerprints — is noise that would churn goldens on
 * changes that are not behavior.
 */
const GOLDEN_HEADERS = [
  "content-type",
  "location",
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-max-age",
  "vary",
] as const;

export interface Golden {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface NormalizeOptions {
  /**
   * Replace at known JSON paths: dotted, with `[]` for every element of an
   * array. A rule that matches nothing THROWS — a golden must never silently
   * stop scrubbing a field that moved, because that is how golden suites decay
   * into rubber stamps.
   */
  paths?: Record<string, string>;
  /** Replace by exact value, anywhere. For fixture ids the test itself created. */
  values?: Record<string, string>;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

export async function normalize(
  res: Response,
  opts: NormalizeOptions = {},
): Promise<Golden> {
  const headers: Record<string, string> = {};
  for (const name of GOLDEN_HEADERS) {
    const value = res.headers.get(name);
    if (value !== null) headers[name] = value;
  }

  const text = await res.clone().text();
  let body: unknown =
    headers["content-type"]?.includes("json") && text.length > 0
      ? (JSON.parse(text) as unknown)
      : text;

  if (opts.paths) body = applyPaths(body, opts.paths);
  if (opts.values) body = applyValues(body, opts.values);

  return { status: res.status, headers, body };
}

function applyPaths(body: unknown, rules: Record<string, string>): unknown {
  let result = body;
  for (const [path, replacement] of Object.entries(rules)) {
    const { value, matched } = replaceAtPath(
      result,
      path.split("."),
      replacement,
    );
    if (!matched) {
      throw new Error(
        `normalize: scrub path "${path}" matched nothing. The field was ` +
          `renamed or removed — update the rule rather than deleting it.`,
      );
    }
    result = value;
  }
  return result;
}

/** Walks one dotted segment at a time; `foo[]` fans out over an array. */
function replaceAtPath(
  node: unknown,
  segments: string[],
  replacement: string,
): { value: unknown; matched: boolean } {
  const [head, ...rest] = segments;
  if (head === undefined) return { value: replacement, matched: true };

  const isArraySegment = head.endsWith("[]");
  const key = isArraySegment ? head.slice(0, -2) : head;

  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return { value: node, matched: false };
  }
  const record = node as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return { value: node, matched: false };
  }

  const child = record[key];

  if (isArraySegment) {
    if (!Array.isArray(child)) return { value: node, matched: false };
    // An empty array is a match with nothing to do: the field exists and the
    // rule is still correct, so this must not throw.
    let matched = true;
    const items = child.map((item) => {
      const outcome = replaceAtPath(item, rest, replacement);
      matched = matched && outcome.matched;
      return outcome.value;
    });
    return { value: { ...record, [key]: items }, matched };
  }

  const outcome = replaceAtPath(child, rest, replacement);
  return {
    value: { ...record, [key]: outcome.value },
    matched: outcome.matched,
  };
}

function applyValues(node: unknown, values: Record<string, string>): unknown {
  if (Array.isArray(node)) return node.map((v) => applyValues(v, values));
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([k, v]) => [
        k,
        applyValues(v, values),
      ]),
    );
  }
  const key = String(node);
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : node;
}
