"use strict";

/**
 * A read-only stand-in for actions/github-script's `github` client, backed by
 * the gh CLI, so the workflow scripts here can run on a laptop with the
 * caller's own GitHub login. It covers only what those scripts call:
 * `graphql`, `request` and `paginate`. Anything but a GET or a GraphQL query
 * throws, so a local run can't change GitHub.
 *
 * A failed call throws an Error with `status` set from gh's "HTTP nnn"
 * message, like Octokit's RequestError.
 */

const { execFileSync } = require("node:child_process");

const fill = (route, params) =>
  route.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(params[key]));

function gh(args) {
  try {
    return JSON.parse(
      execFileSync("gh", args, {
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }).toString(),
    );
  } catch (error) {
    const stderr = String(error.stderr ?? "");
    const failure = new Error(stderr.trim().split("\n").pop() || error.message);
    const status = stderr.match(/HTTP (\d{3})/);
    if (status) failure.status = Number(status[1]);
    throw failure;
  }
}

/**
 * Whether a GraphQL document holds a mutation anywhere, once strings and
 * comments (which GraphQL ignores, so they can hide one) are removed.
 */
const hasMutation = (query) =>
  /\bmutation\b/.test(
    String(query)
      .replace(/"""[\s\S]*?"""/g, "")
      .replace(/"(?:\\.|[^"\\\n])*"/g, "")
      .replace(/#[^\n\r]*/g, ""),
  );

function createGhClient() {
  return {
    graphql: async (query, vars = {}) => {
      if (hasMutation(query))
        throw new Error("local runs are read-only (GraphQL mutation)");
      const args = ["api", "graphql", "-f", `query=${query}`];
      for (const [k, v] of Object.entries(vars))
        if (v != null) args.push("-F", `${k}=${v}`);
      return gh(args).data;
    },
    request: async (route, params = {}) => {
      const [method, path] = route.split(" ");
      if (method !== "GET")
        throw new Error(`local runs are read-only (${route})`);
      return { data: gh(["api", fill(path, params)]) };
    },
    paginate: async (route, params = {}) => {
      const [method, path] = route.split(" ");
      if (method !== "GET")
        throw new Error(`local runs are read-only (${route})`);
      const query = Object.entries(params)
        .filter(([k]) => !path.includes(`{${k}}`))
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&");
      // --slurp wraps each page in one outer array; flatten the pages.
      const url = `${fill(path, params)}?${query}`;
      return gh(["api", "--paginate", "--slurp", url]).flat();
    },
  };
}

module.exports = { createGhClient, hasMutation };
