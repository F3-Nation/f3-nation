# SKILL: Token-Efficient GitHub Operations via `gh api`

> **PURPOSE:** Provides safe, AI-agnostic rules for interacting with GitHub. Designed specifically to minimize LLM token consumption while maintaining strict safety controls.

---

## 🛑 MANDATORY PRE-CHECK & SAFETY DIRECTIVES

1. **Environment Check:** Always execute this verification script BEFORE performing any GitHub operations:

```bash
   bash ./scripts/ai-gh-check.sh
```

_If it fails, output the instructions provided by the script and STOP._

2. **Mandatory Attribution Signature:**
   EVERY payload written to GitHub (Issue body, PR body, or Comment) MUST append this exact signature as the final line:

```text
> _written by [Model Name, e.g., Copilot / Claude]_

```

3. **Draft PR Rule:** All Pull Requests MUST be created as `--draft`. Never create a non-draft PR.
4. **No-Resolve Rule for Comments:** AI models MUST NOT attempt to resolve code review threads or inline comments. Human developers must resolve comments manually after code review.

---

## 💰 TOKEN-SAVING GUIDELINES (STRICTLY ENFORCED)

Raw GitHub REST responses contain non-essential metadata (avatar URLs, permission maps, reaction nodes, node IDs) that consume thousands of unnecessary LLM tokens.

- **Rule 1:** NEVER execute a REST read without an explicit `--jq` filter.
- **Rule 2:** For nested structures (e.g., PR + reviews + comments), use **GraphQL** queries instead of multiple REST calls.

---

## 1. ISSUES (Fetch, Create, Edit, Comment)

### Fetch Issue Details & Essential Metadata

```bash
gh api repos/{owner}/{repo}/issues/<issue_number> \
  --jq '{number, title, state, body, labels: [.labels[].name], assignees: [.assignees[].login]}'

```

### Fetch Issue Comments (Truncated for Context Efficiency)

```bash
gh api repos/{owner}/{repo}/issues/<issue_number>/comments \
  --jq '[.[] | {id, user: .user.login, body: (.body | slice(0; 600))}]'

```

### Create Issue

```bash
gh api -X POST repos/{owner}/{repo}/issues \
  -f title="<Title>" \
  -f body="<Body_Content>\n\n> _written by AI_" \
  --jq '{number, html_url}'

```

### Update Issue Description

```bash
gh api -X PATCH repos/{owner}/{repo}/issues/<issue_number> \
  -f body="<Updated_Body>\n\n> _written by AI_" \
  --jq '{number, updated_at}'

```

### Comment on Issue

```bash
gh api -X POST repos/{owner}/{repo}/issues/<issue_number>/comments \
  -f body="<Comment_Content>\n\n> _written by AI_" \
  --jq '{id, html_url}'

```

---

## 2. PULL REQUESTS (Create, Fetch, Review)

### Create Draft Pull Request

```bash
gh api -X POST repos/{owner}/{repo}/pulls \
  -f title="<Title>" \
  -f head="<branch_name>" \
  -f base="main" \
  -F draft=true \
  -f body="<Description_of_Changes>\n\n> _written by AI_" \
  --jq '{number, html_url, draft}'

```

### Fetch Inline Diff Review Comments (Filtered for Actionable Code Feedback)

```bash
gh api repos/{owner}/{repo}/pulls/<pr_number>/comments \
  --jq '[.[] | {comment_id: .id, path, line, user: .user.login, body: (.body | slice(0; 600))}]'

```

### Reply to an Inline Review Comment

> Use the `comment_id` retrieved from the thread to reply in-line.

```bash
gh api -X POST repos/{owner}/{repo}/pulls/<pr_number>/comments/<comment_id>/replies \
  -f body="<Explanation changes made of>\n\n> _written by AI_" \
  --jq '{id, path, line}'

```

---

## 3. HIGH-EFFICIENCY GRAPHQL READS (Ultra-Low Token Overhead)

Use GraphQL to fetch full context on PRs and reviews in a single query under 300 tokens:

### Fetch PR Context + Review Status in One Query

```bash
gh api graphql -f query='
query {
  repository(owner: "{owner}", name: "{repo}") {
    pullRequest(number: <pr_number>) {
      title
      state
      isDraft
      reviews(first: 5) {
        nodes {
          author { login }
          state
          body
        }
      }
    }
  }
}'

```

---

## 📦 SAFE MULTI-LINE PAYLOAD PATTERN

When posting complex Markdown or multi-line bodies, pass a temporary payload file to prevent shell-escaping errors:

```bash
cat << 'EOF' > /tmp/gh_payload.json
{
  "body": "### Summary of Fixes\n- Updated authentication flow.\n- Added exception handling.\n\n> _written by AI_"
}
EOF

gh api -X POST repos/{owner}/{repo}/issues/<issue_number>/comments --input /tmp/gh_payload.json --jq '{id, html_url}'
rm /tmp/gh_payload.json

```
