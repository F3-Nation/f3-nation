import type { ReactNode } from "react";
import { useMemo, useSyncExternalStore } from "react";

const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const TEXT_NODE_TYPE = 3;
const ELEMENT_NODE_TYPE = 1;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
};

/**
 * Decodes a numeric entity or one of the named ones that show up in region
 * text. This is for the server render; the browser path decodes everything via
 * DOMParser. Unknown names stay as written.
 */
const decodeEntity = (entity: string, body: string): string => {
  if (body.startsWith("#")) {
    const hex = body[1]?.toLowerCase() === "x";
    const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  }
  return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
};

const isHtmlSpace = (char: string | undefined): boolean =>
  char === " " ||
  char === "\t" ||
  char === "\n" ||
  char === "\f" ||
  char === "\r";

/**
 * Index just past the `>` that ends a tag, reading its attributes from `from`
 * the way a browser does, or -1 if the input ends first. Only a quote that
 * opens an attribute value hides `>`; a quote inside a name or an unquoted
 * value (`data-label=don't`) is an ordinary character.
 */
const tagEnd = (html: string, from: number): number => {
  // `name` also covers the space after a name, where `=` still starts a value.
  let state: "between" | "name" | "value" | "unquoted" = "between";
  for (let i = from; i < html.length; i++) {
    const char = html[i];
    if (char === ">") return i + 1;
    if (state === "value") {
      if (char === '"' || char === "'") {
        i = html.indexOf(char, i + 1);
        if (i < 0) return -1;
        state = "between";
      } else if (!isHtmlSpace(char)) {
        state = "unquoted";
      }
    } else if (state === "unquoted") {
      if (isHtmlSpace(char)) state = "between";
    } else if (char === "/") {
      state = "between";
    } else if (char === "=" && state === "name") {
      state = "value";
    } else if (!isHtmlSpace(char)) {
      state = "name";
    }
  }
  return -1;
};

// An end tag's name ends at HTML whitespace, `/` or `>`, so `</script >` and
// `</script x>` close the element but `</script-x>` doesn't.
const BLOCK_END = new Map([
  ["script", /<\/script(?=[\t\n\f\r />])/gi],
  ["style", /<\/style(?=[\t\n\f\r />])/gi],
]);
const COMMENT_END = /--!?>/g;

/** Index just past the end tag of a block whose content starts at `from`. */
const blockEnd = (html: string, from: number, endTag: RegExp): number => {
  endTag.lastIndex = from;
  return endTag.exec(html) ? tagEnd(html, endTag.lastIndex) : -1;
};

/** Index just past a comment whose body starts at `from` (after `<!--`). */
const commentEnd = (html: string, from: number): number => {
  if (html.startsWith(">", from)) return from + 1;
  if (html.startsWith("->", from)) return from + 2;
  COMMENT_END.lastIndex = from;
  return COMMENT_END.exec(html) ? COMMENT_END.lastIndex : -1;
};

/**
 * Plain text of `value`, read in one pass the way a browser tokenizes HTML:
 * tags and comments drop out, `<br>` becomes a newline, and script and style
 * content is skipped up to its end tag. Text is never rescanned, so removing
 * a tag can't join its neighbours into a new one. A tag, comment or block the
 * input never closes takes the rest of the input with it, as in a browser.
 */
const stripHtml = (value: string): string => {
  let text = "";
  let i = 0;
  while (i < value.length) {
    const open = value.indexOf("<", i);
    if (open < 0) {
      text += value.slice(i);
      break;
    }
    text += value.slice(i, open);
    const isEndTag = value[open + 1] === "/";
    const nameStart = isEndTag ? open + 2 : open + 1;
    let next: number;
    if (/[a-z]/i.test(value[nameStart] ?? "")) {
      // A tag name runs to whitespace, `/` or `>`, so `<scr<script>` is one tag.
      let nameEnd = nameStart;
      while (
        nameEnd < value.length &&
        !isHtmlSpace(value[nameEnd]) &&
        value[nameEnd] !== "/" &&
        value[nameEnd] !== ">"
      ) {
        nameEnd++;
      }
      const name = value.slice(nameStart, nameEnd).toLowerCase();
      next = tagEnd(value, nameEnd);
      const endTag = BLOCK_END.get(name);
      if (next >= 0 && !isEndTag && endTag) {
        next = blockEnd(value, next, endTag);
      } else if (next >= 0 && name === "br") {
        text += "\n";
      }
    } else if (isEndTag && nameStart === value.length) {
      text += "</";
      next = nameStart;
    } else if (value.startsWith("<!--", open)) {
      next = commentEnd(value, open + 4);
    } else if (isEndTag || value[open + 1] === "!" || value[open + 1] === "?") {
      // `</>`, `<!DOCTYPE …>` and the like are dropped up to the next `>`.
      const close = value.indexOf(">", open + 2);
      next = close < 0 ? -1 : close + 1;
    } else {
      text += "<";
      next = open + 1;
    }
    if (next < 0) break;
    i = next;
  }
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, decodeEntity).trim();
};

/** Plain-text rendering of `html`; what the server (no DOMParser) shows. */
const htmlToPlainText = (html: string | null | undefined): string =>
  html ? stripHtml(html) : "";

const sanitizeChildNodes = (
  nodes: NodeListOf<ChildNode> | ChildNode[],
  keyPrefix: string,
): ReactNode[] => {
  const safeNodes: ReactNode[] = [];

  Array.from(nodes).forEach((child, index) => {
    safeNodes.push(...sanitizeNode(child, `${keyPrefix}-${index}`));
  });

  return safeNodes;
};

const isSafeHref = (href: string): boolean => {
  const trimmed = href.trim();
  if (!trimmed) return false;

  try {
    const url = new URL(trimmed, "https://example.com");
    return ALLOWED_LINK_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
};

const sanitizeNode = (node: ChildNode, key: string): ReactNode[] => {
  if (node.nodeType === TEXT_NODE_TYPE) {
    const text = node.textContent ?? "";
    return text ? [text] : [];
  }

  if (node.nodeType === ELEMENT_NODE_TYPE) {
    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();

    if (tag === "script" || tag === "style") {
      return [];
    }

    if (tag === "br") {
      return [<br key={key} />];
    }

    if (tag === "a") {
      const href = element.getAttribute("href") ?? "";
      if (!isSafeHref(href)) {
        return sanitizeChildNodes(element.childNodes, key);
      }

      const childContent = sanitizeChildNodes(
        element.childNodes,
        `${key}-child`,
      );
      const safeHref = href.trim();

      return [
        <a key={key} href={safeHref} target="_blank" rel="noopener noreferrer">
          {childContent.length > 0 ? childContent : safeHref}
        </a>,
      ];
    }

    return sanitizeChildNodes(element.childNodes, `${key}-child`);
  }

  return [];
};

// `href` as its own attribute (preceded by whitespace), so `data-href` and
// similar don't count: the sanitizer only keeps a real `href`.
const ANCHOR_HREF =
  /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/**
 * Whether `html` renders anything a visitor can see: text, or a link the
 * sanitizer keeps. An empty-text link still shows, because the sanitizer
 * falls back to the URL as its text.
 */
export const hasVisibleContent = (html: string | null | undefined): boolean => {
  if (!html) return false;
  if (htmlToPlainText(html).trim().length > 0) return true;
  for (const match of html.matchAll(ANCHOR_HREF)) {
    const href = match[1] ?? match[2] ?? match[3] ?? "";
    if (isSafeHref(href)) return true;
  }
  return false;
};

export const sanitizeHtmlToReactNodes = (
  html: string | null | undefined,
): ReactNode[] => {
  if (!html) return [];

  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    const stripped = stripHtml(html);
    return stripped ? [stripped] : [];
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  if (doc.querySelector("parsererror")) {
    const stripped = stripHtml(html);
    return stripped ? [stripped] : [];
  }

  return sanitizeChildNodes(doc.body.childNodes, "safe-html");
};

const subscribeNoop = () => () => undefined;

/**
 * Sanitized nodes for `html`, safe to use in server-rendered client
 * components. The server and the hydration pass both render plain text (the
 * DOMParser path only exists in the browser), then the client swaps in links
 * and line breaks. Calling sanitizeHtmlToReactNodes directly in render would
 * produce different trees on server and client and break hydration.
 */
export function useSanitizedHtml(html: string | null | undefined): ReactNode[] {
  const isClient = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  return useMemo(() => {
    if (isClient) return sanitizeHtmlToReactNodes(html);
    const text = htmlToPlainText(html);
    return text ? [text] : [];
  }, [html, isClient]);
}
