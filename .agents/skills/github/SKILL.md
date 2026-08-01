# SKILL: Token-Efficient GitHub Operations via `gh api`

> **PURPOSE:** Provides safe, AI-agnostic rules for interacting with
> GitHub. Designed specifically to minimize LLM token consumption while
> maintaining strict safety controls.

---

## 🛑 MANDATORY PRE-CHECK & SAFETY DIRECTIVES

1. **Environment Check:** Always execute this verification script BEFORE
   performing any GitHub operations:

```bash
bash .agents/skills/github/scripts/gh-check.sh
```

_If it fails, output the instructions provided by the script and STOP._

1. **Mandatory Attribution Signature:**
   EVERY payload written to GitHub (Issue body, PR body, or Comment)
   MUST append this exact signature as the final line, exactly once.
   Replace `<modelName>` with the exact model or agent name that produced
   the content. Do not use a generic label such as `AI`; examples include
   `Copilot`, `Claude`, or `GPT-4.1`.

   ```markdown
   _written by <model_name>_
   ```

1. **Draft PR Rule:** All Pull Requests MUST be created as
   `gh pr create --draft`. Never create a non-draft PR.
1. **No-Resolve Rule for Comments:** AI models MUST NOT attempt to
   resolve code review threads or inline comments. Human developers must
   resolve comments manually after code review.
1. **Comment Follow-Up Rule:** After addressing any review comment,
   whether by changing code or by deciding the comment is not actionable
   and should be ignored, the AI MUST leave a concise reply in the GitHub
   thread explaining the outcome.

---

## 💰 TOKEN-SAVING GUIDELINES (STRICTLY ENFORCED)

Raw GitHub REST responses contain non-essential metadata (avatar URLs,
permission maps, reaction nodes, node IDs) that consume thousands of
unnecessary LLM tokens.

- **Rule 1:** NEVER execute a REST read without an explicit `--jq`
  filter.
- **Rule 2:** For nested structures (e.g., PR + reviews + comments), use
  **GraphQL** queries instead of multiple REST calls.

---

## 1. ISSUES (Fetch, Create, Edit, Comment)

### Fetch Issue Details & Essential Metadata

```bash
gh api repos/{owner}/{repo}/issues/<issue_number> \
  --jq '{
    number,
    title,
    state,
    body: (.body // "" | if length > 600 then .[0:600] + "…" else . end),
    labels: [.labels[].name],
    assignees: [.assignees[].login]
  }'
```

### Fetch Issue Comments (Truncated for Context Efficiency)

```bash
gh api --paginate --slurp repos/{owner}/{repo}/issues/<issue_number>/comments \
  -f per_page=100 \
  --jq '[.[].[] | {
    id,
    user: .user.login,
    body: (.body // "" | if length > 600 then .[0:600] + "…" else . end)
  }] | .[0:100]'
```

### Create Issue

```bash
gh api -X POST repos/{owner}/{repo}/issues \
  -f title="<Title>" \
  -f body="<Body_Content>\n\n> _written by <model_name>_" \
  --jq '{number, html_url}'
```

### Update Issue Description

```bash
gh api -X PATCH repos/{owner}/{repo}/issues/<issue_number> \
  -f body="<Updated_Body>\n\n> _written by <model_name>_" \
  --jq '{number, updated_at}'
```

### Comment on Issue

```bash
gh api -X POST repos/{owner}/{repo}/issues/<issue_number>/comments \
  -f body="<Comment_Content>\n\n> _written by <model_name>_" \
  --jq '{id, html_url}'
```

---

## 2. PULL REQUESTS (Create, Fetch, Review)

### Create Draft Pull Request

```bash
gh pr create --draft \
  --repo "{owner}/{repo}" \
  --title "<Title>" \
  --head "<branch_name>" \
  --base "main" \
  --body "<Description_of_Changes>\n\n> _written by <model_name>_"
```

### Fetch Inline Diff Review Comments (Filtered for Actionable Code Feedback)

```bash
gh api --paginate --slurp repos/{owner}/{repo}/pulls/<pr_number>/comments \
  -f per_page=100 \
  --jq '[.[].[] | {
    comment_id: .id,
    path,
    line,
    user: .user.login,
    body: (.body // "" | if length > 600 then .[0:600] + "…" else . end)
  }] | .[0:100]'
```

### Reply to an Inline Review Comment

> Use the `comment_id` retrieved from the thread to reply in-line.

```bash
gh api -X POST \
  repos/{owner}/{repo}/pulls/<pr_number>/comments/<comment_id>/replies \
  -f body="<Explanation changes made of>\n\n> _written by <model_name>_" \
  --jq '{id, path, line}'
```

---

## 3. HIGH-EFFICIENCY GRAPHQL READS (Ultra-Low Token Overhead)

Use GraphQL to fetch full context on PRs and reviews in a single query
under 300 tokens:

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
}' \
  --jq '{
    title: .data.repository.pullRequest.title,
    state: .data.repository.pullRequest.state,
    isDraft: .data.repository.pullRequest.isDraft,
    reviews: [.data.repository.pullRequest.reviews.nodes[] | {
      author: .author.login,
      state,
      body: (.body // "" | if length > 600 then .[0:600] + "…" else . end)
    }]
  }'
```

---

## 📦 SAFE MULTI-LINE PAYLOAD PATTERN

When posting complex Markdown or multi-line bodies, pass a temporary
payload file to prevent shell-escaping errors:

```bash
umask 077
payload="$(mktemp)"
trap 'rm -f "$payload"' EXIT

payload_body='### Summary of Fixes
- Updated auth flow.
- Added error handling.

> _written by <model_name>_'

cat <<EOF > "$payload"
{
  "body": "$payload_body"
}
EOF

gh api -X POST \
  repos/{owner}/{repo}/issues/<issue_number>/comments \
  --input "$payload" \
  --jq '{id, html_url}'
```
