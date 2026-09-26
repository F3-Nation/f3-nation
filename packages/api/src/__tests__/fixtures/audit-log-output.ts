import { createLogger } from "@acme/logger";

const instance = createLogger("audit-serializer-test");
for (const code of ["23514", "invalid-synthetic-secret"]) {
  const err = new Error("Failed query: synthetic-secret", {
    cause: Object.assign(new Error("Audit history capture failed"), { code }),
  });
  // Exercise the actual pino serializer, including inheritance by a child.
  instance.logger.error({ err }, "audit.serializer.direct");
  instance.logger
    .child({ requestId: "synthetic" })
    .warn({ err }, "audit.serializer.child");
}
