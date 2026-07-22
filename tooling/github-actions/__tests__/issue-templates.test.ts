import { describe, expect, it } from "vitest";

import {
  extractGithubScript,
  extractMapEntries,
  extractYamlListAfter,
  readRepoFile,
} from "./helpers";

const EXPECTED_APPS = [
  "apps/admin",
  "apps/api",
  "apps/auth",
  "apps/homepage",
  "apps/map",
  "apps/me",
  "apps/slackbot",
];

const TEMPLATES = [
  {
    file: ".github/ISSUE_TEMPLATE/bug_report.yml",
    description: "Which app does this bug affect?",
  },
  {
    file: ".github/ISSUE_TEMPLATE/feature_request.yml",
    description: "Which app is this feature request for?",
  },
];

describe.each(TEMPLATES)("$file", ({ file, description }) => {
  const content = readRepoFile(file);

  it("declares an 'affected-app' dropdown field with the expected label", () => {
    const dropdownIndex = content.indexOf("id: affected-app");
    expect(dropdownIndex).toBeGreaterThanOrEqual(0);

    const dropdownBlock = content.slice(dropdownIndex);
    expect(dropdownBlock).toContain("attributes:");
    expect(dropdownBlock).toContain("label: Affected app");

    const dropdownTypeLine = content.slice(0, dropdownIndex).trimEnd().split("\n").pop();
    expect(dropdownTypeLine).toContain("type: dropdown");
  });

  it("uses a field-appropriate description", () => {
    expect(content).toContain(description);
  });

  it("lists exactly the seven supported apps, in order, with no duplicates", () => {
    const options = extractYamlListAfter(content, "options:");
    expect(options).toEqual(EXPECTED_APPS);
    expect(new Set(options).size).toBe(options.length);
  });

  it("marks the dropdown as required", () => {
    const dropdownIndex = content.indexOf("id: affected-app");
    const afterDropdown = content.slice(dropdownIndex);
    expect(afterDropdown).toMatch(/validations:\s*\n\s*required:\s*true/);
  });

  it("places the affected-app dropdown before the free-form body fields", () => {
    const dropdownIndex = content.indexOf("id: affected-app");
    const firstTextareaIndex = content.indexOf("type: textarea");

    expect(dropdownIndex).toBeGreaterThanOrEqual(0);
    expect(firstTextareaIndex).toBeGreaterThan(dropdownIndex);
  });
});

describe("issue templates and label-issues-by-app workflow stay in sync", () => {
  it("both issue templates offer the exact same set of app options", () => {
    const bugReportOptions = extractYamlListAfter(
      readRepoFile(".github/ISSUE_TEMPLATE/bug_report.yml"),
      "options:",
    );
    const featureRequestOptions = extractYamlListAfter(
      readRepoFile(".github/ISSUE_TEMPLATE/feature_request.yml"),
      "options:",
    );

    expect(bugReportOptions).toEqual(featureRequestOptions);
  });

  it("every dropdown option has a corresponding label mapping in the workflow", () => {
    const workflowYaml = readRepoFile(".github/workflows/label-issues-by-app.yml");
    const script = extractGithubScript(workflowYaml);
    const mapEntries = extractMapEntries(script, "appLabels");
    const mappedApps = mapEntries.map(([app]) => app);

    const templateOptions = extractYamlListAfter(
      readRepoFile(".github/ISSUE_TEMPLATE/bug_report.yml"),
      "options:",
    );

    expect(mappedApps).toEqual(templateOptions);
    expect(mappedApps).toEqual(EXPECTED_APPS);
  });

  it("every mapped label follows the 'app: <name>' convention", () => {
    const workflowYaml = readRepoFile(".github/workflows/label-issues-by-app.yml");
    const script = extractGithubScript(workflowYaml);
    const mapEntries = extractMapEntries(script, "appLabels");

    for (const [app, label] of mapEntries) {
      expect(label).toBe(`app: ${app.replace("apps/", "")}`);
    }
  });
});