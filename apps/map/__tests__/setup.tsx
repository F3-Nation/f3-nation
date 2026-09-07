import type { RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";

// Must be set before vitest-canvas-mock is imported
// because jest-canvas-mock accesses the jest global during initialization
declare global {
  var jest: typeof vi;
}
globalThis.jest = vi;

import "@testing-library/jest-dom";
import "vitest-canvas-mock";

vi.mock("@acme/auth", () => ({
  auth: vi.fn(),
}));

// jsdom does not implement matchMedia; lottie-react checks
// `prefers-reduced-motion` on every load, so any component rendering it needs
// this stubbed out. Guarded because some tests opt out of the jsdom
// environment (`// @vitest-environment node`), where `window` is undefined.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// const mockedORPC = createORPCReact<AppRouter>({
//   overrides: {
//     useMutation: {
//       async onSuccess(opts) {
//         await opts.originalFn();
//         await opts.queryClient.invalidateQueries();
//       },
//     },
//   },
// });

// const mockedORPCClient = mockedORPC.createClient({
//   links: [
//     unstable_httpBatchStreamLink({
//       transformer: superjson,
//       url: "http://localhost:3000/api/orpc",
//       fetch,
//     }),
//   ],
// });

const mockedQueryClient = new QueryClient();

export const MockedORPCProvider = (props: { children: React.ReactNode }) => {
  return (
    // <mockedORPC.Provider
    //   client={mockedORPCClient}
    //   queryClient={mockedQueryClient}
    // >
    <QueryClientProvider client={mockedQueryClient}>
      {props.children}
    </QueryClientProvider>
    // </mockedORPC.Provider>
  );
};

export const renderWithProviders = (
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) => {
  return render(ui, {
    wrapper: (props) => <MockedORPCProvider {...props} />,
    ...options,
  });
};
