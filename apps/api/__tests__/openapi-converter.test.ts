import { OpenAPIGenerator } from "@orpc/openapi";
import { os } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { z } from "zod";
import { describe, expect, it } from "vitest";

// Regression guard for the Zod v3/v4 converter mismatch that broke OpenAPI spec
// generation: the schemas are Zod v4, so the converter must come from
// "@orpc/zod/zod4". The v3 converter ("@orpc/zod") emits a `never` schema for
// every v4 input, which makes every dynamic-param route throw during generation.
// This mirrors the real `event.byId` shape (`z.coerce.number()` param + "/id/{id}").
describe("openapi converter (zod v4)", () => {
  const router = os.prefix("/v1").router({
    event: os.prefix("/event").router({
      byId: os
        .input(
          z.object({
            id: z.coerce
              .number()
              .describe("The unique identifier of the event"),
          }),
        )
        .route({ method: "GET", path: "/id/{id}", tags: ["event"] })
        .output(z.object({ ok: z.boolean() }))
        .handler(() => ({ ok: true })),
    }),
  });

  it("generates a spec exposing dynamic path params as required", async () => {
    const generator = new OpenAPIGenerator({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    });

    const spec = (await generator.generate(router, {
      info: { title: "test", version: "1" },
    })) as {
      paths?: Record<
        string,
        {
          get?: {
            parameters?: { name: string; in: string; required?: boolean }[];
          };
        }
      >;
    };

    const operation = spec.paths?.["/v1/event/id/{id}"]?.get;
    expect(operation).toBeDefined();

    const idParam = operation?.parameters?.find(
      (p) => p.name === "id" && p.in === "path",
    );
    expect(idParam).toBeDefined();
    expect(idParam?.required).toBe(true);
  });
});
