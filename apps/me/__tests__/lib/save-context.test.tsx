import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { SaveProvider, useSave, useSaveRegister } from "@/lib/save-context";

interface SaveValue {
  isDirty: boolean;
  saving: boolean;
  save: () => void;
}

interface SaveRegisterValue {
  register: (opts: {
    isDirty: boolean;
    saving: boolean;
    onSave: () => void;
  }) => void;
  unregister: () => void;
}

let latestSave: SaveValue | null = null;
let latestRegister: SaveRegisterValue | null = null;

function Probe() {
  latestSave = useSave();
  latestRegister = useSaveRegister();
  return null;
}

describe("save-context", () => {
  it("exposes default context values outside provider", () => {
    latestSave = null;
    latestRegister = null;

    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => {
      root.render(<Probe />);
    });

    expect(latestSave).not.toBeNull();
    expect(latestRegister).not.toBeNull();
    expect(latestSave!.isDirty).toBe(false);
    expect(latestSave!.saving).toBe(false);

    expect(() => latestSave!.save()).not.toThrow();
    expect(() =>
      latestRegister!.register({
        isDirty: true,
        saving: true,
        onSave: vi.fn(),
      }),
    ).not.toThrow();
    expect(() => latestRegister!.unregister()).not.toThrow();

    act(() => {
      root.unmount();
    });
  });

  it("registers and unregisters save state in provider", () => {
    latestSave = null;
    latestRegister = null;

    const container = document.createElement("div");
    const root = createRoot(container);
    const onSave = vi.fn();

    act(() => {
      root.render(
        <SaveProvider>
          <Probe />
        </SaveProvider>,
      );
    });

    expect(latestSave!.isDirty).toBe(false);
    expect(latestSave!.saving).toBe(false);

    act(() => {
      latestRegister!.register({
        isDirty: true,
        saving: true,
        onSave,
      });
    });

    expect(latestSave!.isDirty).toBe(true);
    expect(latestSave!.saving).toBe(true);

    act(() => {
      latestSave!.save();
    });

    expect(onSave).toHaveBeenCalledTimes(1);

    act(() => {
      latestRegister!.unregister();
    });

    expect(latestSave!.isDirty).toBe(false);
    expect(latestSave!.saving).toBe(false);

    act(() => {
      root.unmount();
    });
  });
});
