import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VersionInfo } from "~/app/_components/version-info";

import packageJson from "../../../package.json";

describe("VersionInfo", () => {
  it("labels the admin package version and forwards the channel", () => {
    render(<VersionInfo channel="staging" data-testid="version" />);

    const text = screen.getByTestId("version").textContent;
    expect(text).toContain(`v${packageJson.version}`);
    expect(text).toContain("staging");
  });
});
