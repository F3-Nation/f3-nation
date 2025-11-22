/// <reference types="vitest/globals" />

import { NextResponse } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";

import RootLayout from "../app/layout";
import Home from "../app/page";
import nextConfig from "../next.config";
import { proxy } from "../proxy";

describe("app shell", () => {
  it("renders the default layout with SEO guards and children", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <div id="child">Hello</div>
      </RootLayout>,
    );

    expect(html).toContain('lang="en"');
    expect(html).toContain('name="robots"');
    expect(html).toContain('name="googlebot"');
    expect(html).toContain("Hello");
  });

  it("returns null for the placeholder page component", () => {
    expect(Home()).toBeNull();
  });

  it("proxies API routes to Next", () => {
    const response = proxy();

    expect(response).toBeInstanceOf(NextResponse);
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
  });
});

describe("config plumbing", () => {
  it("exposes the Next.js config object", () => {
    expect(nextConfig).toBeDefined();
    expect(typeof nextConfig).toBe("object");
  });

  it("passes the PostCSS plugin config through", async () => {
    const configModule = await import("../postcss.config.mjs");
    const postcssConfig = configModule.default as {
      plugins: Record<string, unknown>;
    };

    expect(postcssConfig.plugins).toHaveProperty("@tailwindcss/postcss");
  });
});
