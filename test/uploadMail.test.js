import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { uploadMail } from "../lib/odooMailUpload.js";

const cfg = { url: "https://odoo.example.com", apikey: "k" };
const realFetch = globalThis.fetch;
let requests;

function mockFetch(result) {
  requests = [];
  globalThis.fetch = async (url, opts) => {
    requests.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify(result) };
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("uploadMail sends model and message without custom_values by default", async () => {
  mockFetch(42);
  assert.equal(
    await uploadMail(cfg, "Subject: hi\r\n\r\nbody", "crm.lead"),
    42,
  );
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/json\/2\/mail\.thread\/message_process$/);
  assert.deepEqual(requests[0].body, {
    model: "crm.lead",
    message: "Subject: hi\r\n\r\nbody",
  });
});

test("uploadMail passes custom_values (e.g. the Helpdesk team)", async () => {
  mockFetch(7);
  await uploadMail(cfg, "Subject: hi", "helpdesk.ticket", { team_id: 3 });
  assert.deepEqual(requests[0].body.custom_values, { team_id: 3 });
});

test("uploadMail keeps model false for generic imports", async () => {
  mockFetch(false);
  await uploadMail(cfg, "Subject: hi");
  assert.equal(requests[0].body.model, false);
  assert.ok(!("custom_values" in requests[0].body));
});

test("listHelpdeskTeams reads id and name ordered by name", async () => {
  const { listHelpdeskTeams } = await import("../lib/odooClient.js");
  mockFetch([{ id: 3, name: "Customer Care" }]);
  assert.deepEqual(await listHelpdeskTeams(cfg), [
    { id: 3, name: "Customer Care" },
  ]);
  assert.match(requests[0].url, /\/json\/2\/helpdesk\.team\/search_read$/);
  assert.deepEqual(requests[0].body, {
    domain: [],
    fields: ["id", "name"],
    order: "name",
  });
});
