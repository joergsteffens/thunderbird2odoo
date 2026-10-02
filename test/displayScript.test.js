// Runs displayScript.js (the status bar) in a fake DOM, with the Helpdesk
// team list and the default team simulated in storage.

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

// The controls of the button row, in order: button labels, "select" for a
// select.
function controls(bar) {
  return button(bar, "Verify").parentElement.children.map((el) =>
    el.tagName === "SELECT" ? "select" : el.textContent,
  );
}

async function clickButton(bar, label) {
  await button(bar, label).click();
  await settle();
  return bar.sentMessages.find((m) => m.action === "addMessage");
}

const ADD_TICKET = "Add as Ticket (Helpdesk)";
const ADD_LEAD = "Add as Opportunity (CRM Lead)";
const ADD_GENERIC = "Add as Generic";

test("without Helpdesk the status bar offers Opportunity and Generic", async () => {
  const bar = await loadStatusBar({});
  assert.deepEqual(controls(bar), ["Verify", ADD_LEAD, ADD_GENERIC]);
  assert.deepEqual(await clickButton(bar, ADD_LEAD), {
    action: "addMessage",
    choice: { model: "crm.lead" },
  });
});

test("Add as Generic sends Generic and warns in its tooltip", async () => {
  const bar = await loadStatusBar({ helpdeskTeams: TEAMS });
  assert.match(button(bar, ADD_GENERIC).title, /Odoo 19/);
  assert.deepEqual((await clickButton(bar, ADD_GENERIC)).choice, {
    model: "generic",
  });
});

test("with one team there is Add as Ticket and no team select", async () => {
  const bar = await loadStatusBar({ helpdeskTeams: [TEAMS[0]] });
  assert.deepEqual(controls(bar), [
    "Verify",
    ADD_TICKET,
    ADD_LEAD,
    ADD_GENERIC,
  ]);
  assert.deepEqual((await clickButton(bar, ADD_TICKET)).choice, {
    model: "helpdesk.ticket",
  });
});

test("with several teams the team select follows Add as Ticket", async () => {
  const bar = await loadStatusBar({ helpdeskTeams: TEAMS });
  assert.deepEqual(controls(bar), [
    "Verify",
    ADD_TICKET,
    "select",
    ADD_LEAD,
    ADD_GENERIC,
  ]);
  const [team] = selects(bar);
  assert.deepEqual(optionValues(team), ["", "3", "7", "9"]);
  assert.equal(team.options[0].textContent, "Default team");
  assert.equal(team.value, "");
  // No default team: Odoo picks the team.
  assert.deepEqual((await clickButton(bar, ADD_TICKET)).choice, {
    model: "helpdesk.ticket",
  });
});

test("the configured default team is preselected", async () => {
  const bar = await loadStatusBar({ helpdeskTeams: TEAMS, helpdeskTeamId: 7 });
  const [team] = selects(bar);
  assert.deepEqual(optionValues(team), ["3", "7", "9"]);
  assert.equal(team.value, "7");
  assert.equal(team.options[1].textContent, "Sales & Support");
  assert.deepEqual((await clickButton(bar, ADD_TICKET)).choice, {
    model: "helpdesk.ticket",
    teamId: "7",
  });
});

test("a default team no longer in the list falls back to Default team", async () => {
  const bar = await loadStatusBar({ helpdeskTeams: TEAMS, helpdeskTeamId: 99 });
  const [team] = selects(bar);
  assert.equal(team.value, "");
  assert.deepEqual((await clickButton(bar, ADD_TICKET)).choice, {
    model: "helpdesk.ticket",
  });
});

test("the team picked by the user is sent", async () => {
  const bar = await loadStatusBar({ helpdeskTeams: TEAMS });
  const [team] = selects(bar);
  team.value = "9";
  assert.deepEqual((await clickButton(bar, ADD_TICKET)).choice, {
    model: "helpdesk.ticket",
    teamId: "9",
  });
});

test("the team is not sent with an Opportunity", async () => {
  const bar = await loadStatusBar({ helpdeskTeams: TEAMS, helpdeskTeamId: 7 });
  assert.deepEqual((await clickButton(bar, ADD_LEAD)).choice, {
    model: "crm.lead",
  });
});

test("loading teams in the options updates an open status bar", async () => {
  const bar = await loadStatusBar({});
  assert.equal(button(bar, ADD_TICKET), undefined);
  await bar.browser.storage.local.set({ helpdeskTeams: TEAMS });
  await settle();
  assert.ok(button(bar, ADD_TICKET));
  assert.equal(selects(bar).length, 1);
});

test("with a predecessor in Odoo, Add sends no choice", async () => {
  const bar = await loadStatusBar({ helpdeskTeams: TEAMS }, "parent_found");
  assert.deepEqual(controls(bar), ["Verify", "Add"]);
  assert.deepEqual(await clickButton(bar, "Add"), { action: "addMessage" });
});
