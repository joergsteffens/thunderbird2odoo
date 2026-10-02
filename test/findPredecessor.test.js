import { test } from "node:test";
import assert from "node:assert/strict";
import { findPredecessor } from "../lib/predecessor.js";

// In-memory stand-ins for the Odoo lookup and the local cache.
function makeDeps(odoo, cache = {}) {
  const calls = { findMails: [] };
  return {
    calls,
    cache,
    findMails: async (cfg, ids) => {
      calls.findMails.push(ids);
      const out = {};
      for (const id of ids)
        if (odoo[id]) out[id] = { status: "found", ...odoo[id] };
      return out;
    },
    getCachedResult: async (id) => cache[id] || null,
    cacheFoundResult: async (id, model, resId, odooMessageId) =>
      (cache[id] = { status: "found", model, resId, odooMessageId }),
    cacheNotFoundResult: async (id) => (cache[id] = { status: "not_found" }),
  };
}

test("findPredecessor returns null without predecessor ids", async () => {
  const deps = makeDeps({});
  assert.equal(await findPredecessor({}, [], deps), null);
  assert.equal(deps.calls.findMails.length, 0);
});

test("findPredecessor queries Odoo once and returns the closest predecessor", async () => {
  const deps = makeDeps({
    b: { model: "helpdesk.ticket", resId: 2, odooMessageId: 20 },
    c: { model: "helpdesk.ticket", resId: 2, odooMessageId: 30 },
  });
  const r = await findPredecessor({}, ["a", "b", "c"], deps);
  assert.deepEqual(deps.calls.findMails, [["a", "b", "c"]]);
  assert.equal(r.messageId, "b");
  assert.equal(r.entry.odooMessageId, 20);
  assert.equal(deps.cache.c.status, "found");
});

test("findPredecessor ignores stale cached entries and marks them not found", async () => {
  const deps = makeDeps(
    {},
    {
      a: {
        status: "found",
        model: "helpdesk.ticket",
        resId: 1,
        odooMessageId: 10,
      },
    },
  );
  assert.equal(await findPredecessor({}, ["a"], deps), null);
  assert.equal(deps.cache.a.status, "not_found");
});

test("findPredecessor leaves unrelated cache entries alone", async () => {
  const deps = makeDeps(
    {},
    { a: { status: "parent_found", parentMessageId: "x" } },
  );
  await findPredecessor({}, ["a"], deps);
  assert.equal(deps.cache.a.status, "parent_found");
});
