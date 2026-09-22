// Mock for @sentry/nextjs in the test environment.
//
// The real package's root entrypoint also re-exports the build-time config
// helpers, which pull in a vendored webpack plugin. That plugin resolves its
// loader path through a browser/Node dual branch keyed on `typeof document`:
// under jsdom `document` exists, so it takes the browser branch and hands
// `fileURLToPath` an `http:` URL, throwing "The URL must be of scheme file"
// before any test body runs. Aliasing the package away keeps any module that
// reports to Sentry importable from a jsdom test.
//
// Tests that assert on Sentry calls still mock it themselves with a factory
// (see `__tests__/utils/hooks/use-upcoming-instances.test.ts`).

export const captureException = () => undefined;
export const captureRequestError = () => undefined;
export const captureRouterTransitionStart = () => undefined;
export const diagnoseSdkConnectivity = () => Promise.resolve(null);
export const init = () => undefined;
export const replayIntegration = () => ({ name: "Replay" });
export const startSpan = <T>(_options: unknown, callback: () => T): T =>
  callback();
