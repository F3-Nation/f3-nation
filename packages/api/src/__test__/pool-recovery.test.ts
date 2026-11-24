import net from "node:net";

import { expect, it, vi } from "vitest";

it(
  "recovers Drizzle queries after established connections become silent",
  { timeout: 20_000 },
  async () => {
    const target = process.env.TEST_DATABASE_URL;
    if (!target) throw new Error("TEST_DATABASE_URL is required");
    const url = new URL(target);
    const destination = { host: url.hostname, port: Number(url.port || 5432) };
    const sockets = new Set<net.Socket>();
    const links: { blocked: boolean }[] = [];
    const relay = net.createServer((front) => {
      const link = { blocked: false };
      links.push(link);
      const back = net.connect(destination);
      for (const socket of [front, back]) {
        sockets.add(socket);
        socket.on("error", () => {
          front.destroy();
          back.destroy();
        });
        socket.on("close", () => {
          sockets.delete(socket);
        });
      }
      front.on("data", (data) => {
        if (!link.blocked) back.write(data);
      });
      back.on("data", (data) => {
        if (!link.blocked) front.write(data);
      });
      front.on("end", () => back.end());
      back.on("end", () => front.end());
    });
    await new Promise<void>((resolve) => {
      relay.listen(0, "127.0.0.1", resolve);
    });
    const address = relay.address() as net.AddressInfo;
    url.hostname = "127.0.0.1";
    url.port = String(address.port);
    vi.resetModules();
    vi.stubEnv("QUERY_TIMEOUT_MS", "1000");
    vi.stubEnv("TEST_DATABASE_URL", url.toString());
    const { createDbClient } = await import("@acme/db/testing");
    const { sql } = await import("@acme/db");
    const client = createDbClient({ recover: true });
    try {
      await Promise.all(
        Array.from({ length: 5 }, () =>
          client.db.execute(sql`select pg_sleep(0.05)`),
        ),
      );
      expect(links).toHaveLength(5);
      for (const link of links) link.blocked = true;
      for (let count = 0; count < 3; count++) {
        await expect(
          client.db.execute(sql`select 1 as answer`),
        ).rejects.toMatchObject({
          cause: {
            message: "Query exceeded 1000ms pool-wait/execution timeout",
          },
        });
      }
      const result = await client.db.execute(sql`select 42 as answer`);
      expect(result).toMatchObject([{ answer: 42 }]);
      expect(client.isLive()).toBe(true);
    } finally {
      await client.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => {
        relay.close(() => resolve());
      });
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  },
);
