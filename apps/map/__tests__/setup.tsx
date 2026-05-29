import type { RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";

// Must be set before vitest-canvas-mock is imported
// because jest-canvas-mock accesses the jest global during initialization.
// Assign via an untyped view of globalThis so this does not redeclare the
// global `jest` (which collides with @types/jest once it is present anywhere
// in the workspace, e.g. apps/region-pages).
(globalThis as Record<string, unknown>).jest = vi;

import "@testing-library/jest-dom";
import "vitest-canvas-mock";

vi.mock("@acme/auth", () => ({
  auth: vi.fn(),
}));

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
