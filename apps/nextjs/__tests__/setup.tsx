import type { RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { unstable_httpBatchStreamLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import fetch from "cross-fetch";
import { createTRPCMsw } from "msw-trpc";
import superjson from "superjson";
import { vi } from "vitest";

import "@testing-library/jest-dom";
import "vitest-canvas-mock";

import type { AppRouter } from "@acme/api";

vi.mock("@acme/auth", () => ({
  auth: vi.fn(),
}));

const mockedTRPC = createTRPCReact<AppRouter>({
  overrides: {
    useMutation: {
      async onSuccess(opts) {
        await opts.originalFn();
        await opts.queryClient.invalidateQueries();
      },
    },
  },
});

const mockedTRPCClient = mockedTRPC.createClient({
  links: [
    unstable_httpBatchStreamLink({
      transformer: superjson,
      url: "http://localhost:3000/api/trpc",
      fetch,
    }),
  ],
});

const mockedQueryClient = new QueryClient();

export const MockedTRPCProvider = (props: { children: React.ReactNode }) => {
  return (
    <mockedTRPC.Provider
      client={mockedTRPCClient}
      queryClient={mockedQueryClient}
    >
      <QueryClientProvider client={mockedQueryClient}>
        {props.children}
      </QueryClientProvider>
    </mockedTRPC.Provider>
  );
};

export const renderWithProviders = (
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) => {
  return render(ui, {
    wrapper: (props) => <MockedTRPCProvider {...props} />,
    ...options,
  });
};

export const trpcMsw = createTRPCMsw<AppRouter>({
  transformer: { input: superjson, output: superjson },
});
