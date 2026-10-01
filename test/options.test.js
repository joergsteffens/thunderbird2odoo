// Runs options.js on the elements of options.html (fake DOM), with the
// stored settings and the background answers simulated. Checks the Import
// Settings section without a real Odoo: cached team lists, a saved team that
// is no longer in the list, failing "Load teams from Odoo".

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createFakeBrowser, settle } from "./helpers/fakeBrowser.js";
import { documentFromHtml } from "./helpers/fakeDom.js";

const HTML = readFileSync(new URL("../options.html", import.meta.url), "utf8");
const SCRIPT = readFileSync(new URL("../options.js", import.meta.url), "utf8");
const CHOICE = readFileSync(
  new URL("../lib/importChoice.js", import.meta.url),
  "utf8",
);
const CONFIG = { url: "https://odoo.example.com", apikey: "k" };
const TEAMS = [
  { id: 3, name: "Customer Care" },
  { id: 7, name: "Technical" },
];
const IMPORT_CONTROLS = [
  "helpdeskTeamId",
  "loadTeams",
  "rewriteDeliveredTo",
  "saveTicket",
];

/**
 * Opens the options page. `background` answers the runtime messages the
 * page sends (listHelpdeskTeams, setup, …); getCacheInfo is answered here.
 */
function openOptions(storage, background = {}) {
  const fb = createFakeBrowser({
    storage,
    onSendMessage: async (msg) => {
      if (msg.action in background) return background[msg.action](msg);
      if (msg.action === "getCacheInfo") return { size: 0, lastSync: null };
      return undefined;
    },
  });
  const document = documentFromHtml(HTML);
  const context = { browser: fb.browser, document, console };
  vm.createContext(context);
  vm.runInContext(CHOICE, context);
  vm.runInContext(SCRIPT, context);
  const el = (id) => document.getElementById(id);
  const requests = () =>
    fb.sentMessages.filter((m) => m.action !== "getCacheInfo");
  return { ...fb, el, requests };
}

function teamOptions(page) {
  return page.el("helpdeskTeamId").options.map((o) => [o.value, o.textContent]);
}

test("Import Settings stay disabled until the stored settings are restored", async () => {
  const page = openOptions({
    ...CONFIG,
    helpdeskTeams: TEAMS,
    helpdeskTeamId: 7,
  });
  for (const id of IMPORT_CONTROLS)
    assert.equal(page.el(id).disabled, true, id + " enabled too early");
  // A click in that moment must not touch the saved team.
  await page.el("saveTicket").click();
  await settle();
  assert.equal(page.storage.helpdeskTeamId, 7);
  for (const id of IMPORT_CONTROLS)
    assert.equal(page.el(id).disabled, false, id);
});

test("Import Settings stay disabled while the add-on is not configured", async () => {
  const page = openOptions({});
  await settle();
  for (const id of IMPORT_CONTROLS)
    assert.equal(page.el(id).disabled, true, id);
});

test("opening the page does not contact Odoo", async () => {
  const page = openOptions({ ...CONFIG, helpdeskTeams: TEAMS });
  await settle();
  assert.deepEqual(page.requests(), []);
});

test("the team select is filled from the cached teams", async () => {
  const page = openOptions({
    ...CONFIG,
    helpdeskTeams: TEAMS,
    helpdeskTeamId: 7,
  });
  await settle();
  assert.deepEqual(teamOptions(page), [
    ["", "— not set —"],
    ["3", "Customer Care"],
    ["7", "Technical"],
  ]);
  assert.equal(page.el("helpdeskTeamId").value, "7");
});

test("a saved team missing from the cached teams is kept on Save", async () => {
  const page = openOptions({
    ...CONFIG,
    helpdeskTeams: TEAMS,
    helpdeskTeamId: 99,
  });
  await settle();
  assert.deepEqual(teamOptions(page).at(-1), [
    "99",
    "Team #99 (not in the loaded teams)",
  ]);
  assert.equal(page.el("helpdeskTeamId").value, "99");
  // The user only changes the Delivered-To setting.
  page.el("rewriteDeliveredTo").checked = true;
  await page.el("saveTicket").click();
  await settle();
  assert.equal(page.storage.helpdeskTeamId, 99);
  assert.equal(page.storage.rewriteDeliveredTo, true);
});

test("a saved team is kept when no teams were ever loaded", async () => {
  const page = openOptions({ ...CONFIG, helpdeskTeamId: 5 });
  await settle();
  assert.equal(page.el("helpdeskTeamId").value, "5");
  await page.el("saveTicket").click();
  await settle();
  assert.equal(page.storage.helpdeskTeamId, 5);
});

test("choosing 'not set' removes the stored team", async () => {
  const page = openOptions({
    ...CONFIG,
    helpdeskTeams: TEAMS,
    helpdeskTeamId: 3,
  });
  await settle();
  page.el("helpdeskTeamId").value = "";
  page.el("rewriteDeliveredTo").checked = true;
  await page.el("saveTicket").click();
  await settle();
  assert.ok(!("helpdeskTeamId" in page.storage));
  assert.equal(page.storage.rewriteDeliveredTo, true);
  assert.equal(page.el("ticketStatus").textContent, "Saved");
});

test("Load teams from Odoo caches the teams and keeps the selection", async () => {
  const loaded = [...TEAMS, { id: 11, name: "Billing" }];
  const page = openOptions(
    { ...CONFIG, helpdeskTeams: TEAMS, helpdeskTeamId: 7 },
    { listHelpdeskTeams: () => ({ ok: true, teams: loaded }) },
  );
  await settle();
  await page.el("loadTeams").click();
  await settle();
  assert.deepEqual(page.storage.helpdeskTeams, loaded);
  assert.equal(teamOptions(page).length, 4);
  assert.equal(page.el("helpdeskTeamId").value, "7");
  assert.equal(page.el("loadTeamsStatus").textContent, "3 teams");
  assert.equal(page.el("loadTeams").disabled, false);
});

test("Load teams does not rewrite storage when the list is unchanged", async () => {
  const page = openOptions(
    { ...CONFIG, helpdeskTeams: TEAMS, helpdeskTeamId: 7 },
    { listHelpdeskTeams: () => ({ ok: true, teams: TEAMS }) },
  );
  await settle();
  let writes = 0;
  page.browser.storage.onChanged.addListener((changes) => {
    if ("helpdeskTeams" in changes) writes++;
  });
  await page.el("loadTeams").click();
  await settle();
  assert.equal(writes, 0);
  assert.equal(page.el("loadTeamsStatus").textContent, "2 teams");
});

test("Load teams without Helpdesk shows the error and keeps the cache", async () => {
  const page = openOptions(
    { ...CONFIG, helpdeskTeams: TEAMS, helpdeskTeamId: 7 },
    {
      listHelpdeskTeams: () => ({
        ok: false,
        error: "Object helpdesk.team doesn't exist",
      }),
    },
  );
  await settle();
  await page.el("loadTeams").click();
  await settle();
  assert.equal(
    page.el("loadTeamsStatus").textContent,
    "Failed: Object helpdesk.team doesn't exist",
  );
  assert.equal(page.el("loadTeams").disabled, false);
  assert.deepEqual(page.storage.helpdeskTeams, TEAMS);
  assert.equal(page.el("helpdeskTeamId").value, "7");
});

test("Load teams re-enables the button when the background does not answer", async () => {
  const page = openOptions(
    { ...CONFIG },
    {
      listHelpdeskTeams: () => {
        throw new Error("Could not establish connection");
      },
    },
  );
  await settle();
  await page.el("loadTeams").click();
  await settle();
  assert.equal(page.el("loadTeams").disabled, false);
  assert.match(page.el("loadTeamsStatus").textContent, /^Failed: Could not/);
});

test("without Helpdesk teams the team is greyed out", async () => {
  const page = openOptions({ ...CONFIG, helpdeskTeamId: 5 });
  await settle();
  assert.equal(page.el("helpdeskTeamId").disabled, true);
  assert.match(
    page.el("helpdeskNote").textContent,
    /^Helpdesk is not available/,
  );
  // The rest of Import Settings stays usable.
  for (const id of ["loadTeams", "rewriteDeliveredTo", "saveTicket"])
    assert.equal(page.el(id).disabled, false, id);
  // Saving keeps the (greyed out) saved team.
  await page.el("saveTicket").click();
  await settle();
  assert.equal(page.storage.helpdeskTeamId, 5);
});

test("with Helpdesk teams the team can be selected", async () => {
  const page = openOptions({ ...CONFIG, helpdeskTeams: TEAMS });
  await settle();
  assert.equal(page.el("helpdeskTeamId").disabled, false);
  assert.equal(page.el("helpdeskNote").textContent, "");
});

test("Load teams: Helpdesk not installed greys out the team", async () => {
  const page = openOptions(
    { ...CONFIG, helpdeskTeams: TEAMS },
    {
      listHelpdeskTeams: () => ({ ok: true, available: false, teams: [] }),
    },
  );
  await settle();
  await page.el("loadTeams").click();
  await settle();
  assert.equal(
    page.el("loadTeamsStatus").textContent,
    "Helpdesk is not installed in Odoo",
  );
  assert.deepEqual(page.storage.helpdeskTeams, []);
  assert.equal(page.el("helpdeskTeamId").disabled, true);
});

test("Load teams: finding teams enables the team", async () => {
  const page = openOptions(
    { ...CONFIG },
    {
      listHelpdeskTeams: () => ({ ok: true, available: true, teams: TEAMS }),
    },
  );
  await settle();
  assert.equal(page.el("helpdeskTeamId").disabled, true);
  await page.el("loadTeams").click();
  await settle();
  assert.equal(page.el("helpdeskTeamId").disabled, false);
  assert.equal(page.el("helpdeskNote").textContent, "");
});

/** Types the connection settings and clicks "Test connection". */
async function testConnection(page) {
  page.el("url").value = CONFIG.url;
  page.el("apikey").value = CONFIG.apikey;
  await page.el("url").dispatch("input");
  await page.el("test").click();
  await settle();
}

test("Test connection also checks Helpdesk, with the settings being tested", async () => {
  const page = openOptions(
    {},
    {
      testConnection: () => ({ ok: true, info: {} }),
      listHelpdeskTeams: () => ({ ok: true, available: false, teams: [] }),
      setup: () => ({ ok: true }),
    },
  );
  await settle();
  await testConnection(page);
  const check = page.requests().find((m) => m.action === "listHelpdeskTeams");
  assert.deepEqual(check.config, { ...CONFIG, db: null });
  assert.equal(
    page.el("loadTeamsStatus").textContent,
    "Helpdesk is not installed in Odoo",
  );
  // Not saved yet: Import Settings stay disabled.
  assert.equal(page.el("loadTeams").disabled, true);
  assert.equal(page.el("helpdeskTeamId").disabled, true);

  // Saving does not check again.
  await page.el("settings").dispatch("submit");
  await settle();
  assert.equal(page.el("status").textContent, "Settings saved");
  assert.deepEqual(
    page.requests().map((m) => m.action),
    ["testConnection", "listHelpdeskTeams", "setup"],
  );
  assert.equal(page.el("loadTeams").disabled, false);
  assert.equal(page.el("helpdeskTeamId").disabled, true);
});

test("Test connection with Helpdesk enables the team after saving", async () => {
  const page = openOptions(
    {},
    {
      testConnection: () => ({ ok: true, info: {} }),
      listHelpdeskTeams: () => ({ ok: true, available: true, teams: TEAMS }),
      setup: () => ({ ok: true }),
    },
  );
  await settle();
  await testConnection(page);
  await page.el("settings").dispatch("submit");
  await settle();
  assert.deepEqual(page.storage.helpdeskTeams, TEAMS);
  assert.equal(page.el("helpdeskTeamId").disabled, false);
});
