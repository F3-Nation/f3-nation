interface F3Runtime {
  mapApiKey?: string;
  apiBaseUrl?: string;
  googleApiKey?: string;
  adminUrl?: string;
  channel?: string;
}
declare global {
  interface Window {
    __F3_RUNTIME__?: F3Runtime;
  }
}
