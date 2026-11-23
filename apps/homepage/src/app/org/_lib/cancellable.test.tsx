// @vitest-environment jsdom
import { StrictMode, useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { runCancellable } from "./cancellable";

describe("runCancellable", () => {
  it("passes the result through when not cancelled", async () => {
    const onResult = vi.fn();
    runCancellable(Promise.resolve(7), onResult, vi.fn());
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(7));
  });

  it("passes the error through when not cancelled", async () => {
    const onError = vi.fn();
    const err = new Error("boom");
    runCancellable(Promise.reject(err), vi.fn(), onError);
    await waitFor(() => expect(onError).toHaveBeenCalledWith(err));
  });

  it("drops a result or error that settles after cancel", async () => {
    const onResult = vi.fn();
    const onError = vi.fn();
    const ok = Promise.resolve(1);
    const bad = Promise.reject(new Error("late"));
    runCancellable(ok, onResult, onError)();
    runCancellable(bad, onResult, onError)();
    await ok;
    await bad.catch(() => undefined);
    await Promise.resolve();
    expect(onResult).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("applies only the surviving run under Strict Mode", async () => {
    let calls = 0;
    const applied: number[] = [];
    function Loader() {
      useEffect(
        () =>
          runCancellable(
            Promise.resolve(++calls),
            (n) => applied.push(n),
            () => undefined,
          ),
        [],
      );
      return null;
    }
    render(
      <StrictMode>
        <Loader />
      </StrictMode>,
    );
    await waitFor(() => expect(applied).toEqual([2]));
    expect(calls).toBe(2);
  });
});
