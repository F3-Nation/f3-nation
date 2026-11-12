"use strict";

// Run with: node --test .github/scripts/gh-local-client.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const { createGhClient, hasMutation } = require("./gh-local-client.cjs");

test("a mutation is found wherever it sits in the document", () => {
  assert.ok(
    hasMutation("mutation { addStar(input: {}) { clientMutationId } }"),
  );
  assert.ok(hasMutation("# a note\nmutation M { deleteIssue { x } }"));
  assert.ok(hasMutation("query A { viewer { login } }\nmutation B { x }"));
});

test("a read-only query passes, even when a string or comment says mutation", () => {
  assert.ok(!hasMutation("query { viewer { login } }"));
  assert.ok(!hasMutation('query { search(query: "mutation") { issueCount } }'));
  assert.ok(!hasMutation('query { a(b: """\nmutation\n""") { c } }'));
  assert.ok(
    !hasMutation("# mutation is not run here\nquery { viewer { id } }"),
  );
});

test("graphql refuses a comment-prefixed mutation before calling gh", async () => {
  await assert.rejects(
    createGhClient().graphql("# hi\nmutation { x }"),
    /local runs are read-only \(GraphQL mutation\)/,
  );
});

test("request and paginate refuse anything but GET", async () => {
  const client = createGhClient();
  await assert.rejects(client.request("POST /repos/o/r/issues"), /read-only/);
  await assert.rejects(client.paginate("DELETE /repos/o/r"), /read-only/);
});
