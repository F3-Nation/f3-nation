import type { SVGProps } from "react";

/**
 * X (formerly Twitter) brand logo.
 *
 * Brand icons were removed from lucide-react in v1, so we inline the official
 * Simple Icons (https://simpleicons.org) path. Uses `currentColor` so it inherits
 * text color like the surrounding lucide icons.
 */
export default function XSvgComponent(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}
