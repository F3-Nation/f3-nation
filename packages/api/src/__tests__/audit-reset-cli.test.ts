import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { expect, it } from "vitest";

import { env } from "@acme/env";

const execute = promisify(execFile);

it("the actual reset CLI exits unsuccessfully when its database connection fails", async () => {
  const target = new URL(env.TEST_DATABASE_URL!);
  // A unique, nonexistent database on the same test server fails before any DDL.
  target.pathname = `/audit_missing_${randomUUID().replaceAll("-", "")}_test`;
  await expect(
    execute(process.execPath, ["--import", "tsx", "../db/src/reset.ts"], {
      env: {
        ...process.env,
        NODE_ENV: "test",
        TEST_DATABASE_URL: target.toString(),
      },
      timeout: 10000,
    }),
  ).rejects.toMatchObject({
    code: 1,
    stdout: expect.stringContaining("does not exist") as string,
  });
}, 15000);
