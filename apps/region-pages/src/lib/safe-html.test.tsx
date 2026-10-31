import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { sanitizeHtmlToReactNodes, useSanitizedHtml } from "@/lib/safe-html";

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

  it.each([
    ["an end tag with whitespace", "<script>alert(1)</script >Hi"],
    ["an end tag with attributes", '<SCRIPT>alert(1)</script x="y">Hi'],
    ["a style block", "<style>p{}</style\n>Hi"],
    ["a block with a lookalike end tag", "<script>a</script-x>b</script>Hi"],
    ["a block with a punctuated end tag", "<script>a</script!>b</script>Hi"],
    ["a style block with a lookalike end tag", "<style>a</style:x>b</style>Hi"],
  ])("drops script and style content in %s", (_, html) => {
    expect(renderToString(<Text html={html} />)).toBe("<p>Hi</p>");
  });

  it("keeps text inside custom elements named like script or style", () => {
    expect(
      renderToString(<Text html="<style-guide>Region info</style-guide>" />),
    ).toBe("<p>Region info</p>");
  });

  it("doesn't join the text around a removed block into a new tag", () => {
    expect(
      renderToString(
        <Text html="<scr<script></script>ipt>alert(1)</script>Hi" />,
      ),
    ).toBe("<p>alert(1)Hi</p>");
  });

  it("strips deeply spliced blocks without a pass per nesting level", () => {
    // Without the block stand-in, remove-until-stable needs a pass per level.
    const n = 100_000;
    const html = `${"<scr".repeat(n)}<script></script>${"ipt></script>".repeat(n)}Hi`;

    const rendered = renderToString(<Text html={html} />);

    expect(rendered).toBe(`<p>${"ipt&gt;".repeat(n - 1)}Hi</p>`);
  });
});
