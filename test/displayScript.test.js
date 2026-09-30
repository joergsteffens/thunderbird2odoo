// Runs displayScript.js (the status bar) in a fake DOM, with the Helpdesk
// team list and the import defaults simulated in storage.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createFakeBrowser, settle } from "./helpers/fakeBrowser.js";
import { FakeDocument } from "./helpers/fakeDom.js";

const SOURCES = [
  "../lib/importChoice.js",
  "../lib/domUtils.js",
  "../displayScript.js",
].map((p) => readFileSync(new URL(p, import.meta.url), "utf8"));
const TEAMS = [
  { id: 3, name: "Customer Care" },
  { id: 7, name: "Sales & Support" },
  { id: 9, name: "Technical" },
];

/**
 * Loads the status bar for an email with the given Odoo status.
 * The fake background answers getOdooStatus and records addMessage.
 */
async function loadStatusBar(storage, status = "not_found") {
  const fb = createFakeBrowser({
    storage,
    onSendMessage: async (msg) => {
      if (msg.action === "getOdooStatus") return { status };
      if (msg.action === "addMessage")
        return { status: "found", success: true };
      return undefined;
    },
  });
  const document = new FakeDocument();
  const context = { messenger: fb.browser, document, console };
  context.window = context;
  vm.createContext(context);
  for (const src of SOURCES) vm.runInContext(src, context);
  await settle();
  return { ...fb, document };
}

function selects(bar) {
  return bar.document.query((el) => el.tagName === "SELECT");
}

function optionValues(select) {
  return select.options.map((o) => o.value);
}

function button(bar, label) {
  return bar.document.query(
    (el) => el.tagName === "BUTTON" && el.textContent === label,
  )[0];
}

async function clickAdd(bar) {
  await button(bar, "Add").click();
  await settle();
  return bar.sentMessages.find((m) => m.action === "addMessage");
}

test("without Helpdesk the status bar offers Opportunity and Generic", async () => {
  const bar = await loadStatusBar({});
  const [importAs, ...rest] = selects(bar);
  assert.deepEqual(optionValues(importAs), ["crm.lead", "generic"]);
  assert.equal(importAs.value, "crm.lead");
  assert.equal(rest.length, 0);
  assert.deepEqual(await clickAdd(bar), {
    action: "addMessage",
    choice: { model: "crm.lead" },
  });
});

test("a stored Ticket default shows Opportunity while Helpdesk is missing", async () => {
  const bar = await loadStatusBar({ defaultImportAs: "helpdesk.ticket" });
  assert.equal(selects(bar)[0].value, "crm.lead");
});

test("with one team Ticket is preselected and there is no team select", async () => {
  const bar = await loadStatusBar({ helpdeskTeams: [TEAMS[0]] });
  const [importAs, ...rest] = selects(bar);
  assert.deepEqual(optionValues(importAs), [
    "helpdesk.ticket",
    "crm.lead",
    "generic",
  ]);
  assert.equal(importAs.value, "helpdesk.ticket");
  assert.equal(rest.length, 0);
  assert.deepEqual((await clickAdd(bar)).choice, { model: "helpdesk.ticket" });
});

test("with several teams and no default team Odoo picks the team", async () => {
  const bar = await loadStatusBar({ helpdeskTeams: TEAMS });
  const [, team] = selects(bar);
  assert.deepEqual(optionValues(team), ["", "3", "7", "9"]);
  assert.equal(team.options[0].textContent, "Default team");
  assert.equal(team.value, "");
  assert.deepEqual((await clickAdd(bar)).choice, { model: "helpdesk.ticket" });
});

test("the configured default team is preselected", async () => {
  const bar = await loadStatusBar({ helpdeskTeams: TEAMS, helpdeskTeamId: 7 });
  const [, team] = selects(bar);
  assert.deepEqual(optionValues(team), ["3", "7", "9"]);
  assert.equal(team.value, "7");
  assert.equal(team.options[1].textContent, "Sales & Support");
  assert.deepEqual((await clickAdd(bar)).choice, {
    model: "helpdesk.ticket",
    teamId: "7",
  });
});

test("a default team no longer in the list falls back to Default team", async () => {
  const bar = await loadStatusBar({ helpdeskTeams: TEAMS, helpdeskTeamId: 99 });
  const [, team] = selects(bar);
  assert.equal(team.value, "");
  assert.deepEqual((await clickAdd(bar)).choice, { model: "helpdesk.ticket" });
});

test("the team picked by the user is sent", async () => {
  const bar = await loadStatusBar({ helpdeskTeams: TEAMS });
  const [, team] = selects(bar);
  team.value = "9";
  assert.deepEqual((await clickAdd(bar)).choice, {
    model: "helpdesk.ticket",
    teamId: "9",
  });
});

test("the team select is hidden for Opportunity and Generic", async () => {
  const bar = await loadStatusBar({ helpdeskTeams: TEAMS, helpdeskTeamId: 7 });
  const [importAs, team] = selects(bar);
  assert.equal(team.style.display, "");
  importAs.value = "crm.lead";
  await importAs.dispatch("change");
  assert.equal(team.style.display, "none");
  // The hidden team is not sent with an Opportunity.
  assert.deepEqual((await clickAdd(bar)).choice, { model: "crm.lead" });
});

test("a Generic default is preselected", async () => {
  const bar = await loadStatusBar({
    helpdeskTeams: TEAMS,
    defaultImportAs: "generic",
  });
  assert.equal(selects(bar)[0].value, "generic");
});

test("loading teams in the options updates an open status bar", async () => {
  const bar = await loadStatusBar({});
  assert.equal(selects(bar).length, 1);
  await bar.browser.storage.local.set({ helpdeskTeams: TEAMS });
  await settle();
  const [importAs, team] = selects(bar);
  assert.equal(importAs.value, "helpdesk.ticket");
  assert.ok(team);
});

test("with a predecessor in Odoo, Add sends no choice", async () => {
  const bar = await loadStatusBar({ helpdeskTeams: TEAMS }, "parent_found");
  assert.equal(selects(bar).length, 0);
  assert.deepEqual(await clickAdd(bar), { action: "addMessage" });
});
