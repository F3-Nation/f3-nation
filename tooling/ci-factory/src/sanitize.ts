/**
 * Neutralize GitHub-comment side effects in untrusted, model-derived text
 * before it is interpolated into a PR comment.
 *
 * Every reviewer / triage field the factory renders is model output built from
 * PR-controlled input: the diff, the failing-test artifacts, and the
 * PR-authored spec source. Without this, a crafted PR could induce a bot
 * comment that @-mentions people (notification spam / abuse), autolinks
 * arbitrary issues/PRs, or injects raw HTML (`<img>`, `<details>`, a forged
 * `<!-- ... -->` control marker). We break the trigger characters without
 * changing how the text reads to a human.
 *
 * Text rendered inside an inline code span (backticks) does not need this:
 * GitHub does not process mentions, autolinks, or HTML there, so only
 * free-text (prose / table-cell) fields are sanitized.
 */

// U+200B ZERO WIDTH SPACE, inserted after a trigger char to break GitHub's
// mention / autolink parsing while staying invisible to a human reader.
const ZERO_WIDTH_SPACE = "\u200B";

export function sanitizeForComment(text: string): string {
  return (
    text
      // Break @mentions and @org/team mentions: a zero-width space after the
      // "@" stops GitHub from linking while the text still reads as "@name".
      .replace(/@(?=[A-Za-z0-9_-])/g, `@${ZERO_WIDTH_SPACE}`)
      // Break #<number> issue/PR autolinks the same way.
      .replace(/#(?=\d)/g, `#${ZERO_WIDTH_SPACE}`)
      // Render any HTML angle brackets as literal text so model output can't
      // inject markup or forge the `<!-- ... -->` dedup markers the poster
      // keys on.
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
  );
}
