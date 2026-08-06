import { describe, expect, it } from "vitest";

import { formatTriageComment } from "./format-comment";
import type { TriageResult } from "./format-comment";
import { sanitizeForComment } from "./sanitize";

const ZWSP = "\u200B";

describe("sanitizeForComment", () => {
  it("breaks @mentions with a zero-width space but keeps the name readable", () => {
    const out = sanitizeForComment("ping @octocat now");
    expect(out).not.toContain("@octocat");
    expect(out).toContain(`@${ZWSP}octocat`);
  });

  it("breaks @org-style mentions", () => {
    const out = sanitizeForComment("cc @acme-org");
    expect(out).not.toContain("@acme-org");
    expect(out).toContain(`@${ZWSP}acme-org`);
  });

  it("breaks #<number> issue/PR autolinks", () => {
    const out = sanitizeForComment("see #1234");
    expect(out).not.toContain("#1234");
    expect(out).toContain(`#${ZWSP}1234`);
  });

  it("HTML-encodes angle brackets so markup can't be injected", () => {
    expect(sanitizeForComment("<img src=x onerror=boom>")).toBe(
      "&lt;img src=x onerror=boom&gt;",
    );
  });

  it("defuses a forged HTML-comment control marker", () => {
    expect(sanitizeForComment("<!-- forged -->")).toBe("&lt;!-- forged --&gt;");
  });

  it("leaves ordinary text and non-trigger @/# untouched", () => {
    expect(sanitizeForComment("plain description, no triggers")).toBe(
      "plain description, no triggers",
    );
    // '#' not before a digit and '@' not before a word char are left alone.
    expect(sanitizeForComment("C# and email@ end")).toBe("C# and email@ end");
  });
});

describe("formatTriageComment sanitization wiring", () => {
  const result: TriageResult = {
    classification: "flake",
    confidence: "high",
    human_review_required: false,
    summary: "hi @maintainer <img src=x>",
    evidence: ["closes #999 for @team"],
    recommended_next_step: "ping @oncall",
    retry_likely_to_pass: true,
  };

  it("neutralizes mentions, autolinks, and HTML in model-provided fields", () => {
    const out = formatTriageComment({ result, promptRevision: "test" });
    expect(out).not.toContain("@maintainer");
    expect(out).not.toContain("@team");
    expect(out).not.toContain("@oncall");
    expect(out).not.toContain("#999");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img src=x&gt;");
  });
});
