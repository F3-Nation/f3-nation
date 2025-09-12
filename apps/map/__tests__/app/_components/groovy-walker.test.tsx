import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GroovyWalker } from "../../../src/app/_components/groovy-walker";

describe("groovy walker component", () => {
  it("should render class", async () => {
    const { container } = render(<GroovyWalker />);
    expect(container.firstChild).toHaveClass("h-16 w-16");
  });
});
