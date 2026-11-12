/**
 * The api_keys_fill_hash trigger keeps key_hash and key_hint in step with the
 * plaintext key on every insert and key update, so rows written by code that
 * only sets key are never left unhashed.
 *
 * These tests require TEST_DATABASE_URL to point at the migrated test database.
 */
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { eq, inArray, schema } from "@acme/db";

import { db, uniqueId } from "./testing";

const sha256Hex = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

describe("api_keys_fill_hash trigger", () => {
  const createdIds: number[] = [];

  afterAll(async () => {
    if (createdIds.length > 0) {
      await db
        .delete(schema.apiKeys)
        .where(inArray(schema.apiKeys.id, createdIds));
    }
  });

  it("fills key_hash and key_hint on insert", async () => {
    const key = `f3_trigger_${uniqueId()}`;
    const [row] = await db
      .insert(schema.apiKeys)
      .values({ key, name: "trigger insert test" })
      .returning();
    if (!row) throw new Error("insert returned no row");
    createdIds.push(row.id);

    expect(row.keyHash).toBe(sha256Hex(key));
    expect(row.keyHint).toBe(key.slice(-4));
  });

  it("refills key_hash and key_hint when key changes", async () => {
    const [row] = await db
      .insert(schema.apiKeys)
      .values({ key: `f3_before_${uniqueId()}`, name: "trigger update test" })
      .returning();
    if (!row) throw new Error("insert returned no row");
    createdIds.push(row.id);

    const next = `f3_after_${uniqueId()}`;
    const [updated] = await db
      .update(schema.apiKeys)
      .set({ key: next })
      .where(eq(schema.apiKeys.id, row.id))
      .returning();

    expect(updated?.keyHash).toBe(sha256Hex(next));
    expect(updated?.keyHint).toBe(next.slice(-4));
  });
});
