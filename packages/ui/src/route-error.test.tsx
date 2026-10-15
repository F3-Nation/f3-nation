import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { RouteError } from "./route-error";

afterEach(cleanup);

const boom = (message = "boom") => Object.assign(new Error(message), {});

describe("RouteError", () => {
  it("reports the error once on mount", () => {
    const onError = vi.fn();
    const error = boom();

    render(<RouteError error={error} reset={vi.fn()} onError={onError} />);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("does not re-report on an ordinary rerender, even with a fresh onError closure", () => {
    const first = vi.fn();
    const second = vi.fn();
    const error = boom();
    const reset = vi.fn();

    const { rerender } = render(
      <RouteError error={error} reset={reset} onError={first} />,
    );
    rerender(<RouteError error={error} reset={reset} onError={second} />);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("reports again when the error instance changes", () => {
    const onError = vi.fn<(error: Error) => void>();
    const reset = vi.fn();
    const a = boom("a");
    const b = boom("b");

    const { rerender } = render(
      <RouteError error={a} reset={reset} onError={onError} />,
    );
    rerender(<RouteError error={b} reset={reset} onError={onError} />);

    expect(onError.mock.calls.map(([e]) => e)).toEqual([a, b]);
  });

  it("renders without an onError handler", () => {
    render(<RouteError error={boom()} reset={vi.fn()} />);

    expect(screen.getByRole("heading").textContent).toBe(
      "Something went wrong",
    );
  });

  it("calls reset when the user clicks Try again", () => {
    const reset = vi.fn();

    render(<RouteError error={boom()} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
