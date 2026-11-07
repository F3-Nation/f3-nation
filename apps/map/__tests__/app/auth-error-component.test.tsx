import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ErrorComponent from "~/app/auth/error/error-component";

const searchParamsMock = vi.hoisted((): { error: string | null } => ({
  error: null,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "error" ? searchParamsMock.error : null),
  }),
}));

vi.mock("~/app/_components/version-info", () => ({
  VersionInfo: () => null,
}));

describe("auth error screen sign-in recovery link", () => {
  beforeEach(() => {
    searchParamsMock.error = null;
  });

  it.each(["Verification", "AccessDenied"])(
    "points the %s Sign in action at the real sign-in route",
    (error) => {
      searchParamsMock.error = error;
      render(<ErrorComponent />);

      expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
        "href",
        "/auth/sign-in",
      );
    },
  );
});
