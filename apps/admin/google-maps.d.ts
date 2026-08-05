// Loads the global `google.maps` namespace into the TS program.
// @vis.gl/react-google-maps shipped this triple-slash directive itself until
// 1.8.3 dropped it. The base tsconfig's `types` allowlist disables automatic
// @types/* inclusion, but an explicit reference like this still loads the types
// — so we keep it here instead of overriding `types` per app.
/// <reference types="google.maps" />
