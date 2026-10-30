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

// End tags allow whitespace and attributes (`</script >`, `</script x>`),
// since browsers close the element on those too.
const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi;
const STYLE_BLOCK = /<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi;
const ANY_TAG = /<[^>]*>/g;

/**
 * Plain text of `value`. Each removal repeats until nothing changes: one pass
 * can splice a new tag together from the text around the one it removed
 * (`<scr<script></script>ipt>`).
 */
const stripHtml = (value: string): string => {
  let text = value;
  let previous: string;
  do {
    previous = text;
    text = text.replace(SCRIPT_BLOCK, "").replace(STYLE_BLOCK, "");
  } while (text !== previous);
  text = text.replace(/<br\s*\/?>/gi, "\n");
  do {
    previous = text;
    text = text.replace(ANY_TAG, "");
  } while (text !== previous);
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
