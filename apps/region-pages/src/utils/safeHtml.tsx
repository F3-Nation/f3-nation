import type { ReactNode } from 'react';

const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const TEXT_NODE_TYPE = 3;
const ELEMENT_NODE_TYPE = 1;

const stripHtml = (value: string): string =>
  value
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim();

const sanitizeChildNodes = (
  nodes: NodeListOf<ChildNode> | ChildNode[],
  keyPrefix: string
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
    const url = new URL(trimmed, 'https://example.com');
    return ALLOWED_LINK_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
};

const sanitizeNode = (node: ChildNode, key: string): ReactNode[] => {
  if (node.nodeType === TEXT_NODE_TYPE) {
    const text = node.textContent ?? '';
    return text ? [text] : [];
  }

  if (node.nodeType === ELEMENT_NODE_TYPE) {
    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();

    if (tag === 'script' || tag === 'style') {
      return [];
    }

    if (tag === 'br') {
      return [<br key={key} />];
    }

    if (tag === 'a') {
      const href = element.getAttribute('href') ?? '';
      if (!isSafeHref(href)) {
        return sanitizeChildNodes(element.childNodes, key);
      }

      const childContent = sanitizeChildNodes(
        element.childNodes,
        `${key}-child`
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

export const sanitizeHtmlToReactNodes = (
  html: string | null | undefined
): ReactNode[] => {
  if (!html) return [];

  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    const stripped = stripHtml(html);
    return stripped ? [stripped] : [];
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  if (doc.querySelector('parsererror')) {
    const stripped = stripHtml(html);
    return stripped ? [stripped] : [];
  }

  return sanitizeChildNodes(doc.body.childNodes, 'safe-html');
};
