import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import type { Root } from "react-dom/client";
import { hydrateRoot } from "react-dom/client";
import { cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import {
  hasVisibleContent,
  sanitizeHtmlToReactNodes,
  useSanitizedHtml,
} from "@/lib/safe-html";

const renderHtml = (html: string | null | undefined) =>
  render(<>{sanitizeHtmlToReactNodes(html)}</>);

afterEach(() => {
  cleanup();
});

describe("sanitizeHtmlToReactNodes", () => {
  it("returns an empty array for null, undefined, or empty input", () => {
    expect(sanitizeHtmlToReactNodes(null)).toEqual([]);
    expect(sanitizeHtmlToReactNodes(undefined)).toEqual([]);
    expect(sanitizeHtmlToReactNodes("")).toEqual([]);
  });

  it("removes script elements and their contents", () => {
    const { container } = renderHtml("<script>alert(1)</script>Hello");

    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toBe("Hello");
  });

  it("removes style elements and their contents", () => {
    const { container } = renderHtml("<style>p{color:red}</style>Hello");

    expect(container.querySelector("style")).toBeNull();
    expect(container.textContent).toBe("Hello");
  });

  it("keeps text while unwrapping formatting tags", () => {
    const { container } = renderHtml("<p>Hello <b>bold</b> world</p>");

    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toBe("Hello bold world");
  });

  it("keeps line breaks", () => {
    const { container } = renderHtml("line one<br>line two");

    expect(container.querySelector("br")).not.toBeNull();
  });

  it("drops elements that are not on the allowlist, such as images with handlers", () => {
    const { container } = renderHtml('<img src="x" onerror="alert(1)">Text');

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("Text");
  });

  it("keeps https links with safe attributes", () => {
    const { container } = renderHtml(
      '<a href="https://example.com/page">Visit</a>',
    );

    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/page");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.textContent).toBe("Visit");
  });

  it("keeps mailto links", () => {
    const { container } = renderHtml(
      '<a href="mailto:hi@example.com">Email</a>',
    );

    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "mailto:hi@example.com",
    );
  });

  it("drops javascript: links but keeps their text", () => {
    const { container } = renderHtml(
      '<a href="javascript:alert(1)">click me</a>',
    );

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("click me");
  });

  it("drops other non-allowlisted protocols, e.g. data:", () => {
    const { container } = renderHtml('<a href="data:text/html,hello">see</a>');

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("see");
  });

  it.each([
    ["tel:1234", "call"],
    ["/example", "relative"],
  ])("keeps allowlisted %s links", (href, text) => {
    const { container } = renderHtml(`<a href="${href}">${text}</a>`);

    expect(container.querySelector("a")).toHaveAttribute("href", href);
  });

  it("drops links without an href but keeps their text", () => {
    const { container } = renderHtml("<a>no link</a>");

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("no link");
  });

  it("shows the href as the link text when the anchor has no content", () => {
    const { container } = renderHtml('<a href="https://example.com"></a>');

    expect(container.querySelector("a")?.textContent).toBe(
      "https://example.com",
    );
  });
});

describe("useSanitizedHtml", () => {
  function Description({ html }: { html: string }) {
    return <p>{useSanitizedHtml(html)}</p>;
  }

  it("server-renders decoded plain text (the hydration pass matches it)", () => {
    const html = renderToString(
      <Description
        html={'A &amp; B<br>Go <a href="https://f3.com">here</a>'}
      />,
    );
    expect(html).toBe("<p>A &amp; B\nGo here</p>");
  });

  it("swaps in sanitized links once mounted in the browser", () => {
    const { container } = render(
      <Description html={'Go <a href="https://f3.com">here</a>'} />,
    );
    expect(container.querySelector("a")).toHaveAttribute(
      "href",
      "https://f3.com",
    );
  });
});

describe("server text decoding", () => {
  function Text({ html }: { html: string }) {
    return <p>{useSanitizedHtml(html)}</p>;
  }

  it("decodes numeric and common named entities, leaving unknown ones", () => {
    expect(
      renderToString(<Text html="It&#8217;s 5&mdash;6 &#x2764; &bogus;" />),
    ).toBe("<p>It’s 5—6 ❤ &amp;bogus;</p>");
  });

  it("cuts text longer than 10,000 characters to 10,000 ending in an ellipsis", () => {
    expect(renderToString(<Text html={`<b>${"a".repeat(10_001)}</b>`} />)).toBe(
      `<p>${"a".repeat(9_999)}…</p>`,
    );
  });

  it("keeps text of exactly 10,000 characters whole", () => {
    expect(renderToString(<Text html={"a".repeat(10_000)} />)).toBe(
      `<p>${"a".repeat(10_000)}</p>`,
    );
  });

  it("doesn't leave half of an emoji at the cut", () => {
    expect(renderToString(<Text html={`${"a".repeat(9_998)}💪💪`} />)).toBe(
      `<p>${"a".repeat(9_998)}…</p>`,
    );
  });

  it("keeps a whole emoji that ends at the cut, and the emoji before it", () => {
    expect(renderToString(<Text html={`💪${"a".repeat(9_995)}💪💪`} />)).toBe(
      `<p>💪${"a".repeat(9_995)}💪…</p>`,
    );
  });

  it("hydrates cut text without errors, then shows the full text", async () => {
    // Escaped characters before the cut, an emoji straddling it.
    const html = `${"&lt;".repeat(5_000)}${"a".repeat(4_998)}💪 and more`;
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Text html={html} />);
    expect(container.textContent).toBe(
      `${"<".repeat(5_000)}${"a".repeat(4_998)}…`,
    );

    const errors: unknown[] = [];
    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(container, <Text html={html} />, {
        onRecoverableError: (error) => errors.push(error),
      });
    });

    expect(errors).toEqual([]);
    expect(container.textContent).toBe(
      `${"<".repeat(5_000)}${"a".repeat(4_998)}💪 and more`,
    );
    act(() => root?.unmount());
  });

  it.each([
    ["an end tag with whitespace", "<script>alert(1)</script >Hi"],
    ["an end tag with attributes", '<SCRIPT>alert(1)</script x="y">Hi'],
    ["a style block", "<style>p{}</style\n>Hi"],
    ["a block with a lookalike end tag", "<script>a</script-x>b</script>Hi"],
    ["a block with a punctuated end tag", "<script>a</script!>b</script>Hi"],
    ["a style block with a lookalike end tag", "<style>a</style:x>b</style>Hi"],
    ["an unquoted value with a quote", "<script x=don't>alert(1)</script>Hi"],
    ["a name with a quote", '<style a"b c=d>p{}</style>Hi'],
  ])("drops script and style content in %s", (_, html) => {
    expect(renderToString(<Text html={html} />)).toBe("<p>Hi</p>");
  });

  it("keeps text inside custom elements named like script or style", () => {
    expect(
      renderToString(<Text html="<style-guide>Region info</style-guide>" />),
    ).toBe("<p>Region info</p>");
    expect(
      renderToString(<Text html="<script-x>Region</script-x> info</script>" />),
    ).toBe("<p>Region info</p>");
  });

  it("ignores an end tag inside a quoted attribute", () => {
    const html = `<script data-x="> </script >">alert(1)</script>`;

    expect(renderToString(<Text html={html} />)).toBe("<p></p>");
    expect(hasVisibleContent(html)).toBe(false);
  });

  it("reads `<scr<script>` as one tag, as a browser does", () => {
    expect(
      renderToString(
        <Text html="<scr<script></script>ipt>alert(1)</script>Hi" />,
      ),
    ).toBe("<p>ipt&gt;alert(1)Hi</p>");
  });

  it("drops comments, declarations and stray end tags but keeps a bare `<` or `</`", () => {
    expect(
      renderToString(
        <Text html="<!DOCTYPE html><!-- <b>x</b> -->1 < 2<!---->,</><?x?> ok</" />,
      ),
    ).toBe("<p>1 &lt; 2, ok&lt;/</p>");
  });

  it.each([
    ["an unclosed script", "Hi<script>a"],
    ["an unclosed tag", 'Hi<b title="a>b'],
    ["an unclosed comment", "Hi<!-- a"],
  ])("drops the rest of the input after %s", (_, html) => {
    expect(renderToString(<Text html={html} />)).toBe("<p>Hi</p>");
  });

  // Each case rescans the rest of the input once per tag if a scan restarts.
  it.each([
    [
      "spliced blocks",
      `${"<scr".repeat(1e5)}<script></script>${"ipt></script>".repeat(1e5)}Hi`,
      // Capped at 10,000 characters: 2,499 × "ipt>", then "ipt" and the ellipsis.
      `${"ipt&gt;".repeat(2_499)}ipt…`,
    ],
    ["unclosed blocks", `Hi${"<script>".repeat(1e5)}`, "Hi"],
    ["unclosed tags", `Hi${"<style ".repeat(1e5)}`, "Hi"],
    ["unclosed end tags", `Hi<script>${"</script".repeat(1e5)}`, "Hi"],
  ])("reads %s in one pass", (_, html, text) => {
    expect(renderToString(<Text html={html} />)).toBe(`<p>${text}</p>`);
  });
});

describe("hasVisibleContent", () => {
  it.each([
    "<a href=https://f3boone.com></a>",
    "<A HREF = 'https://f3boone.com'></A>",
  ])("counts a kept link with no text: %j", (html) => {
    expect(hasVisibleContent(html)).toBe(true);
  });

  it.each([
    ["inside a comment", '<!-- <a href="https://f3boone.com"></a> -->'],
    ["inside a script", '<script><a href="https://f3boone.com"></a></script>'],
    ["on a custom element", '<a-b href="https://f3boone.com"></a-b>'],
    [
      "after an unsafe first href",
      '<a href="javascript:x" href="https://f3boone.com"></a>',
    ],
    ["with an encoded unsafe scheme", '<a href="javascript&#58;x"></a>'],
    ["in an unclosed tag", '<a href="https://f3boone.com"'],
  ])("ignores a link %s", (_, html) => {
    expect(hasVisibleContent(html)).toBe(false);
  });

  it("reads many unclosed tags in one pass", () => {
    expect(hasVisibleContent("<a href".repeat(1e5))).toBe(false);
  });
});
