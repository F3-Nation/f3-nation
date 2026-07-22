import { beforeEach, describe, expect, it, vi } from "vitest";

import { AsyncFunction, extractGithubScript, readRepoFile } from "./helpers";

const WORKFLOW_PATH = ".github/workflows/label-issues-by-app.yml";
const workflowYaml = readRepoFile(WORKFLOW_PATH);
const scriptSource = extractGithubScript(workflowYaml);

interface IssueLabel {
  name: string;
}

interface RunOptions {
  body?: string | null;
  labels?: (string | IssueLabel)[];
  owner?: string;
  repo?: string;
  issueNumber?: number;
  existingLabelNames?: string[];
}

function buildMocks({
  body = "### Affected app\n\napps/api\n\n### Describe the bug\n\nSomething broke.",
  labels,
  owner = "acme",
  repo = "f3-nation",
  issueNumber = 42,
  existingLabelNames = [],
}: RunOptions = {}) {
  const resolvedLabels = labels ?? existingLabelNames;

  const core = { info: vi.fn() };

  const getLabel = vi.fn().mockResolvedValue({});
  const createLabel = vi.fn().mockResolvedValue({});
  const removeLabel = vi.fn().mockResolvedValue({});
  const addLabels = vi.fn().mockResolvedValue({});

  const github = {
    rest: {
      issues: { getLabel, createLabel, removeLabel, addLabels },
    },
  };

  const context = {
    payload: {
      issue: {
        number: issueNumber,
        body,
        labels: resolvedLabels,
      },
    },
    repo: { owner, repo },
  };

  return { core, github, context, getLabel, createLabel, removeLabel, addLabels };
}

/** Runs the workflow's inline script with the given mocked `github`/`context`/`core`. */
async function runScript(mocks: ReturnType<typeof buildMocks>) {
  const run = new AsyncFunction("github", "context", "core", scriptSource);
  return run(mocks.github, mocks.context, mocks.core);
}

describe("label-issues-by-app workflow script", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing and logs when the issue body has no 'Affected app' field", async () => {
    const mocks = buildMocks({ body: "### Describe the bug\n\nNo affected app field here." });

    await runScript(mocks);

    expect(mocks.core.info).toHaveBeenCalledWith("No affected app field found in issue body.");
    expect(mocks.getLabel).not.toHaveBeenCalled();
    expect(mocks.addLabels).not.toHaveBeenCalled();
  });

  it("does nothing and logs when the issue body is null", async () => {
    const mocks = buildMocks({ body: null });

    await runScript(mocks);

    expect(mocks.core.info).toHaveBeenCalledWith("No affected app field found in issue body.");
    expect(mocks.getLabel).not.toHaveBeenCalled();
  });

  it("does nothing and logs when the selected app is not labelable", async () => {
    const mocks = buildMocks({
      body: "### Affected app\n\n_No response_\n\n### Describe the bug\n\nDetails.",
    });

    await runScript(mocks);

    expect(mocks.core.info).toHaveBeenCalledWith("Affected app is not labelable: _No response_");
    expect(mocks.getLabel).not.toHaveBeenCalled();
    expect(mocks.addLabels).not.toHaveBeenCalled();
  });

  it("trims surrounding whitespace from the captured app value", async () => {
    const mocks = buildMocks({
      body: "### Affected app\n\n  apps/map  \n\n### Describe the bug\n\nDetails.",
    });

    await runScript(mocks);

    expect(mocks.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["app: map"] }),
    );
  });

  it("matches the 'Affected app' heading case-insensitively", async () => {
    const mocks = buildMocks({
      body: "### affected APP\n\napps/auth\n\n### Describe the bug\n\nDetails.",
    });

    await runScript(mocks);

    expect(mocks.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["app: auth"] }),
    );
  });

  it("creates every missing app label before applying the selected one", async () => {
    const mocks = buildMocks();
    mocks.getLabel.mockRejectedValue({ status: 404 });

    await runScript(mocks);

    expect(mocks.createLabel).toHaveBeenCalledTimes(7);
    expect(mocks.createLabel).toHaveBeenCalledWith({
      owner: "acme",
      repo: "f3-nation",
      name: "app: api",
      color: "5319e7",
      description: "Issue affects apps/api",
    });
  });

  it("does not create a label that already exists", async () => {
    const mocks = buildMocks();
    mocks.getLabel.mockResolvedValue({});

    await runScript(mocks);

    expect(mocks.createLabel).not.toHaveBeenCalled();
  });

  it("re-throws unexpected errors from getLabel instead of swallowing them", async () => {
    const mocks = buildMocks();
    mocks.getLabel.mockRejectedValue({ status: 500 });

    await expect(runScript(mocks)).rejects.toEqual({ status: 500 });
    expect(mocks.createLabel).not.toHaveBeenCalled();
  });

  it("adds the selected app label when it is not already present", async () => {
    const mocks = buildMocks({ existingLabelNames: [] });

    await runScript(mocks);

    expect(mocks.addLabels).toHaveBeenCalledWith({
      owner: "acme",
      repo: "f3-nation",
      issue_number: 42,
      labels: ["app: api"],
    });
  });

  it("does not re-add the selected app label when it is already present", async () => {
    const mocks = buildMocks({ existingLabelNames: ["app: api"] });

    await runScript(mocks);

    expect(mocks.addLabels).not.toHaveBeenCalled();
  });

  it("removes other app labels that no longer match the selected app", async () => {
    const mocks = buildMocks({ existingLabelNames: ["app: admin", "app: auth"] });

    await runScript(mocks);

    expect(mocks.removeLabel).toHaveBeenCalledTimes(2);
    expect(mocks.removeLabel).toHaveBeenCalledWith({
      owner: "acme",
      repo: "f3-nation",
      issue_number: 42,
      name: "app: admin",
    });
    expect(mocks.removeLabel).toHaveBeenCalledWith({
      owner: "acme",
      repo: "f3-nation",
      issue_number: 42,
      name: "app: auth",
    });
    expect(mocks.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["app: api"] }),
    );
  });

  it("leaves non-app labels untouched", async () => {
    const mocks = buildMocks({ existingLabelNames: ["🐞❔ unconfirmed bug"] });

    await runScript(mocks);

    expect(mocks.removeLabel).not.toHaveBeenCalled();
    expect(mocks.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["app: api"] }),
    );
  });

  it("supports issue labels provided as label objects instead of plain strings", async () => {
    const mocks = buildMocks({
      labels: [{ name: "app: admin" }, { name: "🐞❔ unconfirmed bug" }],
    });

    await runScript(mocks);

    expect(mocks.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "app: admin" }),
    );
    expect(mocks.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["app: api"] }),
    );
  });
});

describe("label-issues-by-app workflow configuration", () => {
  it("triggers only on issue opened/edited events", () => {
    expect(workflowYaml).toMatch(/on:\s*\n\s*issues:\s*\n\s*types:\s*\[opened,\s*edited\]/);
  });

  it("skips pull-request-linked issue events", () => {
    expect(workflowYaml).toContain("if: ${{ !github.event.issue.pull_request }}");
  });

  it("requests the minimum permissions needed to label issues", () => {
    expect(workflowYaml).toMatch(/permissions:\s*\n\s*contents:\s*read\s*\n\s*issues:\s*write/);
  });

  it("pins actions/github-script to a full commit SHA", () => {
    expect(workflowYaml).toMatch(/uses:\s*actions\/github-script@[0-9a-f]{40}\s*#\s*v\d+\.\d+\.\d+/);
  });
});