// Disable SendGrid click/open tracking on auth mail. Harmless on non-SendGrid
// transports (e.g. Mailpit), which ignore the header.
export const NO_TRACKING_HEADERS = {
  "X-SMTPAPI": JSON.stringify({
    filters: {
      clicktrack: { settings: { enable: 0 } },
      opentrack: { settings: { enable: 0 } },
    },
  }),
};
