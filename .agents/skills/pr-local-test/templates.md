# Templates

Fill these in plain language: feature names, not file names (except where the user has to act
on a file). Drop any section marked _(only if …)_ when it doesn't apply, rather than writing
"none". Several runs can be going at once, so every message names the PR in its first line.

## Stop message

Use this whenever Phase 0 or `init` finds problems. Every problem goes in one message, and each
gets its own numbered block. When a problem has several fixes, give them as options.

```markdown
⏸️ **Paused before testing PR #<N>.** I found <count> thing(s) to fix first.

**1. <Problem, in one plain sentence.>**
<Fix, as an exact step. Put commands in a bash code block. For more than one fix, write "Pick one:" and list the options.>
<Only if the fix has a side effect worth knowing about, add one line saying what it is.>

**2. …**

Your own checkout, dev servers, and database aren't affected.
Tell me when that's done and I'll check again.
```

## Test plan

```markdown
## 🧪 Test plan — PR #<N>: <what the code does, in your own words>

> ⚠️ **The description doesn't match the code** _(only if Phase 2b found something)_
>
> - The description says <claim>, but the code <reality>.
> - The code also <change>, which the description doesn't mention.
>
> I'm testing the code as written; the results will repeat this.

> 📝 **Feedback can't be posted from this machine** _(only if `CAN_POST` is false)_
> Your GitHub login can't comment on this repo. I'll draft the feedback for you to paste.

> 🛡️ **Safety check** _(only if gated)_
> This PR comes from <outside the team / a fork>. Running it will <install N new packages /
> run a new setup script / contact <host>>, with your Google Maps key in its settings.
> Reply **"go, run it"** to allow that. Anything else and I'll clean up without running it.

**What changed:** <1–2 sentences a volunteer would follow.>
**Parts of F3 affected:** <Map · Admin · Sign-in · …>
**Automatic checks (CI):** <✅ all passed / ⚠️ N failing: … / ➖ none ran>

| #   | What we'll check                                  | How                                                                       | Who           | Test data we'll create           |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------- | ------------- | -------------------------------- |
| 1   | <outcome, e.g. "A region admin can rename an AO"> | <one line>                                                                | 🤖 Agent      | <e.g. a test region with one AO> |
| 2   | …                                                 | …                                                                         | 🙋 You        | —                                |
| 3   | <e.g. "Error reports name the real cause">        | Can't be seen safely from this machine; the PR's automated tests cover it | ➖ Tests only | —                                |

**Your part:** <"Nothing — the agent handles every check." / "N checks, about M minutes.">
**Sandbox:** its own copy of the code, database, and ports (<first port>–<last port>), so your own work keeps running. <"Removed when we're done." / "Kept running afterwards, as you asked.">
**Other test runs on this machine:** <only if any: "N running" / "N left over from closed sessions; say 'clean up pr-local-test' to remove them">

<Not gated:> Starting now. Say **stop** at any time.
<Gated:> Waiting for **"go, run it"**.
```

## Results

```markdown
## 🧾 Results — PR #<N>

> ### <✅ Recommendation: Approve | ✅ Recommendation: Approve, with optional suggestions | ❌ Recommendation: Don't approve yet | ⏸️ Can't recommend yet>
>
> <One plain sentence on why.>
> <❌/⏸️ only: what would change this, e.g. "Fix the crash when a region has no AOs, then re-test.">
> <✅ with suggestions only: "The suggestions below are optional; the PR does what it set out to do without them.">

| #   | Check                      | Result    | Notes                    |
| --- | -------------------------- | --------- | ------------------------ |
| 1   | <same wording as the plan> | ✅ Passed |                          |
| 2   | …                          | ❌ Failed | <what happened, plainly> |

✅ Passed · ❌ Failed · ⚠️ Passed with warnings · ⏭️ Skipped · ⏸️ Blocked · ➖ Covered by automated tests

### 🔴 Problems caused by this PR _(only if any)_

1. **<plain description>.** <who it affects and how.> Screenshot: `<evidence path>`

### 🐞 Older bugs found, not caused by this PR _(only if any)_

These stay out of the PR review. Each one is either already tracked or gets a new issue.

- **<plain description>.** Already tracked in #<n>.
- **<plain description>.** New issue drafted: "<title>"

### 🙋 Your turn _(only if 🙋 checks exist)_

The apps are still running. Please:

1. Open <this run's URL> and <step>. You should see <expected>.
   Tell me what happened for each one.

### 🧹 Sandbox

<"Removed: test apps stopped, test database deleted, code copy and ports released. Only the drafts below remain, until you answer." / "Still running, as you asked: Map <url> · Admin <url> · … Say **update** after new commits to re-test, or **done** to remove it.">

### 💬 Proposed GitHub changes for PR #<N> (nothing has been posted yet)

**PR summary comment:** <2–4 line preview>
**Line comments (<count>):**

- <plain one-liner> → `<path>:<line>`

**New issues to file (<count>)** _(only if any)_:

- "<title>": <one plain line on what it's about>

Reply **post** to publish the review for PR #<N> and file the issues. You can also approve just one ("post the review only", "file the issues only"), tell me what to change, or say **skip** to post nothing.
```
