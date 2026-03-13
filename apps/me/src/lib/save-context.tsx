"use client";

import { createContext, useContext, useState, useCallback } from "react";

interface SaveState {
  isDirty: boolean;
  saving: boolean;
  save: () => void;
}

const SaveContext = createContext<SaveState>({
  isDirty: false,
  saving: false,
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  save: () => {},
});

interface RegisterFn {
  register: (opts: {
    isDirty: boolean;
    saving: boolean;
    onSave: () => void;
  }) => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const RegisterContext = createContext<RegisterFn>({ register: () => {} });

export function SaveProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SaveState>({
    isDirty: false,
    saving: false,
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    save: () => {},
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
