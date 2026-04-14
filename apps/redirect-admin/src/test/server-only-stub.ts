// Vitest stub for `server-only`. The real module throws on import so
// that a client bundle can never ship server-only code; tests don't
// have that concern, so this empty module lets the server modules be
// imported without side effects.
export {};
