"use client";

import { createContext, useContext, useState, useCallback } from "react";

interface SaveState {
  isDirty: boolean;
  saving: boolean;
  save: () => void;
}

const noop = () => {
  /* intentional no-op: default context value before registration */
};

const SaveContext = createContext<SaveState>({
  isDirty: false,
  saving: false,
  save: noop,
});

interface RegisterFn {
  register: (opts: {
    isDirty: boolean;
    saving: boolean;
    onSave: () => void;
  }) => void;
}

const RegisterContext = createContext<RegisterFn>({ register: noop });

export function SaveProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SaveState>({
    isDirty: false,
    saving: false,
    save: noop,
  });

  const register = useCallback(
    (opts: { isDirty: boolean; saving: boolean; onSave: () => void }) => {
      setState({
        isDirty: opts.isDirty,
        saving: opts.saving,
        save: opts.onSave,
      });
    },
    [],
  );

  return (
    <RegisterContext.Provider value={{ register }}>
      <SaveContext.Provider value={state}>{children}</SaveContext.Provider>
    </RegisterContext.Provider>
  );
}

export function useSave() {
  return useContext(SaveContext);
}

export function useSaveRegister() {
  return useContext(RegisterContext);
}
