import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VersionInfo } from "@/components/version-info";
import type { ChangelogEntry } from "@/lib/changelog";

afterEach(cleanup);

const entry: ChangelogEntry = {
  version: "1.2.0",
  date: "2024-06-01",
  sections: [{ title: "Features", items: ["add profile avatar upload"] }],
};

describe("VersionInfo", () => {
  it("renders version and channel in the trigger button", () => {
    render(<VersionInfo version="1.2.0" channel="staging" changelog={[]} />);
    expect(screen.getByRole("button")).toHaveTextContent("v1.2.0");
    expect(screen.getByRole("button")).toHaveTextContent("(staging)");
  });

  it("shows empty state message when changelog is empty", async () => {
    render(<VersionInfo version="1.0.0" channel="local" changelog={[]} />);
    await userEvent.click(screen.getByRole("button", { name: /v1\.0\.0/ }));
    expect(screen.getByText(/no changelog entries yet/i)).toBeInTheDocument();
  });

  it("renders changelog entries when dialog is opened", async () => {
    render(<VersionInfo version="1.2.0" channel="local" changelog={[entry]} />);
    await userEvent.click(screen.getByRole("button", { name: /v1\.2\.0/ }));
    expect(screen.getByText("Features")).toBeInTheDocument();
    expect(screen.getByText("add profile avatar upload")).toBeInTheDocument();
    expect(screen.getByText("June 1, 2024")).toBeInTheDocument();
  });
});
