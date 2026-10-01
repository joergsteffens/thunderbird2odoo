// Runs background.js against a fake Thunderbird and a fake Odoo, with the
// Helpdesk team list simulated in storage (as cached by the options page)
// and the user's answer in the import dialog simulated.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createFakeBrowser,
  installFakeOdoo,
  settle,
} from "./helpers/fakeBrowser.js";

const CONFIG = { url: "https://odoo.example.com", apikey: "k" };
const ONE_TEAM = [{ id: 3, name: "Customer Care" }];
const TEAMS = [
  { id: 3, name: "Customer Care" },
  { id: 7, name: "Sales & Support" },
  { id: 9, name: "Technical" },
];
const RAW_MAIL =
  "Message-ID: <new-1@example.com>\r\n" +
  "X-Original-To: support@example.com\r\n" +
  "Delivered-To: mbox@internal.example.com\r\n" +
  "From: customer@example.com\r\n" +
  "To: support@example.com\r\n" +
  "Subject: Help\r\n" +
  "\r\n" +
  "body\r\n";

const realFetch = globalThis.fetch;
const realDebug = console.debug;
let loadCount = 0;

afterEach(() => {
  globalThis.fetch = realFetch;
  console.debug = realDebug;
  delete globalThis.browser;
  delete globalThis.messenger;
});

/**
 * Loads a fresh copy of background.js with the given storage content.
 * The query string makes node evaluate the module again for each test.
 *
 * @param {Object} storage
 * @param {Object} [opts]
 * @param {Function} [opts.answer] the user's click in the dialogs, see
 *   createFakeBrowser({answerDialog}); by default dialogs are closed
 * @param {Object} [opts.odoo] fake Odoo routes
 */
async function loadBackground(
  storage,
  { rawMail = RAW_MAIL, odoo = {}, answer } = {},
) {
  const requests = installFakeOdoo({
    "mail.thread/message_process": () => 42,
    ...odoo,
  });
  console.debug = () => {}; // background.js logs every step
  const fb = createFakeBrowser({ storage, rawMail, answerDialog: answer });
  globalThis.browser = fb.browser;
  globalThis.messenger = fb.browser;
  // showResult() copies the record URL to the clipboard.
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: async () => {} } },
    configurable: true,
    writable: true,
  });
  await import("../background.js?instance=" + ++loadCount);
  return { ...fb, requests };
}

/** Dialog answer: click the button with value `choice`. */
function click(choice, values = {}) {
  return () => ({ choice, values });
}

async function importFromMenu(fb) {
  await fb.browser.menus.onClicked.fire(
    { menuItemId: "odoo-import", selectedMessages: { messages: [{ id: 1 }] } },
    {},
  );
  await settle();
}

function uploads(fb) {
  return fb.requests
    .filter((r) => r.route === "mail.thread/message_process")
    .map((r) => r.body);
}

function importDialog(fb) {
  return fb.dialogs.find((d) => /How do you want to import it/.test(d.message));
}

// --- right-click menu ------------------------------------------------------

test("no menu while the add-on is not configured", async () => {
  const fb = await loadBackground({ helpdeskTeams: TEAMS });
  assert.equal(fb.menus.size, 0);
});

test("the menu has a single Import entry, with or without Helpdesk", async () => {
  for (const teams of [undefined, ONE_TEAM, TEAMS]) {
    const fb = await loadBackground({ ...CONFIG, helpdeskTeams: teams });
    assert.deepEqual(
      [...fb.menus.values()].map((m) => [m.id, m.title]),
      [
        ["odoo-connector", "Odoo Email Connector"],
        ["odoo-import", "Import this email"],
        ["odoo-verify", "Verify"],
        ["odoo-sync", "Sync message status from Odoo"],
      ],
    );
  }
});

test("Import is hidden when several emails are selected", async () => {
  const fb = await loadBackground({ ...CONFIG });
  const messages = [{ id: 1 }, { id: 2 }];
  await fb.browser.menus.onShown.fire({ selectedMessages: { messages } });
  assert.equal(fb.menus.get("odoo-import").visible, false);
  assert.equal(fb.menus.get("odoo-verify").title, "Verify 2 messages");
});

// --- import dialog -----------------------------------------------------------

test("without Helpdesk the dialog offers Opportunity and Generic as before", async () => {
  const fb = await loadBackground({ ...CONFIG });
  await importFromMenu(fb);
  const dialog = importDialog(fb);
  assert.deepEqual(
    dialog.buttons.map((b) => b.title),
    ["Opportunity (CRM Lead)", "Generic"],
  );
  assert.deepEqual(dialog.selects, []);
  assert.equal(uploads(fb).length, 0, "closing the dialog imports nothing");
});

test("with one team the dialog adds Ticket without a team select", async () => {
  const fb = await loadBackground({ ...CONFIG, helpdeskTeams: ONE_TEAM });
  await importFromMenu(fb);
  const dialog = importDialog(fb);
  assert.deepEqual(
    dialog.buttons.map((b) => b.title),
    ["Ticket (Helpdesk)", "Opportunity (CRM Lead)", "Generic"],
  );
  assert.deepEqual(dialog.selects, []);
});

test("with several teams the dialog has a team select", async () => {
  const fb = await loadBackground({ ...CONFIG, helpdeskTeams: TEAMS });
  await importFromMenu(fb);
  const [team] = importDialog(fb).selects;
  assert.equal(team.id, "team");
  assert.deepEqual(
    team.options.map((o) => [o.value, o.label]),
    [
      ["", "Default team"],
      ["3", "Customer Care"],
      ["7", "Sales & Support"],
      ["9", "Technical"],
    ],
  );
  assert.equal(team.selected, "");
});

test("the dialog preselects the configured default team", async () => {
  const fb = await loadBackground({
    ...CONFIG,
    helpdeskTeams: TEAMS,
    helpdeskTeamId: 9,
  });
  await importFromMenu(fb);
  const [team] = importDialog(fb).selects;
  assert.equal(team.selected, "9");
  assert.ok(!team.options.some((o) => o.value === ""));
});

test("Ticket with one team leaves the team to Odoo", async () => {
  const fb = await loadBackground(
    { ...CONFIG, helpdeskTeams: ONE_TEAM },
    { answer: click("helpdesk.ticket") },
  );
  await importFromMenu(fb);
  const [body] = uploads(fb);
  assert.equal(body.model, "helpdesk.ticket");
  assert.ok(!("custom_values" in body));
});

test("the team picked in the dialog is passed as team_id", async () => {
  const fb = await loadBackground(
    { ...CONFIG, helpdeskTeams: TEAMS, helpdeskTeamId: 3 },
    { answer: click("helpdesk.ticket", { team: "7" }) },
  );
  await importFromMenu(fb);
  const [body] = uploads(fb);
  assert.equal(body.model, "helpdesk.ticket");
  assert.deepEqual(body.custom_values, { team_id: 7 });
});

test("Ticket without a picked team uses the configured default team", async () => {
  const fb = await loadBackground(
    { ...CONFIG, helpdeskTeams: ONE_TEAM, helpdeskTeamId: 3 },
    { answer: click("helpdesk.ticket") },
  );
  await importFromMenu(fb);
  assert.deepEqual(uploads(fb)[0].custom_values, { team_id: 3 });
});

test("a default team no longer in the team list is not sent", async () => {
  const fb = await loadBackground(
    { ...CONFIG, helpdeskTeams: TEAMS, helpdeskTeamId: 99 },
    { answer: click("helpdesk.ticket", { team: "" }) },
  );
  await importFromMenu(fb);
  assert.ok(!("custom_values" in uploads(fb)[0]));
});

test("a team is not sent with an Opportunity", async () => {
  const fb = await loadBackground(
    { ...CONFIG, helpdeskTeams: TEAMS },
    { answer: click("crm.lead", { team: "7" }) },
  );
  await importFromMenu(fb);
  const [body] = uploads(fb);
  assert.equal(body.model, "crm.lead");
  assert.ok(!("custom_values" in body));
});

test("Generic imports without a model", async () => {
  const fb = await loadBackground({ ...CONFIG }, { answer: click("generic") });
  await importFromMenu(fb);
  assert.equal(uploads(fb)[0].model, false);
});

test("an email already in Odoo is only reported, without the dialog", async () => {
  const fb = await loadBackground(
    { ...CONFIG, helpdeskTeams: TEAMS },
    {
      answer: click("helpdesk.ticket"),
      odoo: {
        "mail.message/search_read": () => [
          {
            id: 5,
            message_id: "<new-1@example.com>",
            model: "helpdesk.ticket",
            res_id: 11,
          },
        ],
      },
    },
  );
  await importFromMenu(fb);
  assert.equal(importDialog(fb), undefined);
  assert.equal(uploads(fb).length, 0);
});

test("a reply is attached to the predecessor's record, without asking the type", async () => {
  const reply = RAW_MAIL.replace(
    "Subject: Help",
    "In-Reply-To: <parent@example.com>\r\nSubject: Re: Help",
  );
  const fb = await loadBackground(
    { ...CONFIG, helpdeskTeams: TEAMS },
    {
      rawMail: reply,
      answer: click(0), // "Import" in the predecessor confirmation
      odoo: {
        "mail.message/search_read": (body) =>
          JSON.stringify(body.domain).includes("parent@example.com")
            ? [
                {
                  id: 6,
                  message_id: "<parent@example.com>",
                  model: "helpdesk.ticket",
                  res_id: 11,
                },
              ]
            : [],
      },
    },
  );
  await importFromMenu(fb);
  assert.equal(importDialog(fb), undefined);
  assert.match(fb.dialogs[0].message, /^Predecessor email found/);
  const [body] = uploads(fb);
  assert.equal(body.model, false);
  assert.ok(!("custom_values" in body));
});

test("an Odoo error is shown in a dialog", async () => {
  const fb = await loadBackground(
    { ...CONFIG, helpdeskTeams: ONE_TEAM },
    {
      answer: (d) => (d.buttons.length ? { choice: "helpdesk.ticket" } : null),
      odoo: {
        "mail.thread/message_process": () => {
          throw new Error("Invalid field team_id");
        },
      },
    },
  );
  await importFromMenu(fb);
  const error = fb.dialogs.find((d) => d.title === "Odoo – Error");
  assert.match(error.message, /Invalid field team_id/);
});

// --- import from the status bar ("Add") --------------------------------------

async function addFromStatusBar(fb, choice) {
  const msg = { action: "addMessage", messageId: 1 };
  if (choice) msg.choice = choice;
  const [result] = await fb.browser.runtime.onMessage.fire(msg, {});
  await settle();
  return result;
}

test("Add passes the model and team chosen in the status bar, without the dialog", async () => {
  const fb = await loadBackground({ ...CONFIG, helpdeskTeams: TEAMS });
  const result = await addFromStatusBar(fb, {
    model: "helpdesk.ticket",
    teamId: "7",
  });
  assert.equal(result.success, true);
  assert.equal(importDialog(fb), undefined);
  assert.deepEqual(uploads(fb)[0].custom_values, { team_id: 7 });
});

test("Add with Opportunity from the status bar", async () => {
  const fb = await loadBackground({ ...CONFIG });
  await addFromStatusBar(fb, { model: "crm.lead" });
  assert.equal(uploads(fb)[0].model, "crm.lead");
});

test("Add as Ticket without Helpdesk imports as Opportunity", async () => {
  // A status bar rendered before the teams were removed can still send it.
  const fb = await loadBackground({ ...CONFIG, helpdeskTeams: [] });
  await addFromStatusBar(fb, { model: "helpdesk.ticket" });
  assert.equal(uploads(fb)[0].model, "crm.lead");
});

test("Add without a choice asks in the dialog", async () => {
  const fb = await loadBackground({ ...CONFIG }, { answer: click("crm.lead") });
  await addFromStatusBar(fb);
  assert.ok(importDialog(fb));
  assert.equal(uploads(fb)[0].model, "crm.lead");
});

// --- Delivered-To option -----------------------------------------------------

test("Delivered-To is sent unchanged while the option is off", async () => {
  const fb = await loadBackground({ ...CONFIG }, { answer: click("crm.lead") });
  await importFromMenu(fb);
  assert.match(
    uploads(fb)[0].message,
    /^Delivered-To: mbox@internal\.example\.com$/m,
  );
});

test("Delivered-To is replaced with X-Original-To when the option is on", async () => {
  const fb = await loadBackground(
    { ...CONFIG, rewriteDeliveredTo: true },
    { answer: click("crm.lead") },
  );
  await importFromMenu(fb);
  const { message } = uploads(fb)[0];
  assert.match(message, /^Delivered-To: support@example\.com$/m);
  assert.doesNotMatch(message, /internal\.example\.com/);
});

// --- listHelpdeskTeams --------------------------------------------------------

async function listTeams(fb, msg = {}) {
  const [result] = await fb.browser.runtime.onMessage.fire(
    { action: "listHelpdeskTeams", ...msg },
    {},
  );
  return result;
}

test("listHelpdeskTeams reports Helpdesk as not installed", async () => {
  const fb = await loadBackground(
    { ...CONFIG },
    { odoo: { "ir.model/search_count": () => 0 } },
  );
  assert.deepEqual(await listTeams(fb), {
    ok: true,
    available: false,
    teams: [],
  });
  assert.ok(!fb.requests.some((r) => r.route === "helpdesk.team/search_read"));
});

test("listHelpdeskTeams returns the teams when Helpdesk is installed", async () => {
  const fb = await loadBackground(
    { ...CONFIG },
    {
      odoo: {
        "ir.model/search_count": (body) => {
          assert.deepEqual(body.domain, [["model", "=", "helpdesk.team"]]);
          return 1;
        },
        "helpdesk.team/search_read": () => TEAMS,
      },
    },
  );
  assert.deepEqual(await listTeams(fb), {
    ok: true,
    available: true,
    teams: TEAMS,
  });
});

test("listHelpdeskTeams uses the settings being tested when given", async () => {
  const fb = await loadBackground(
    {},
    {
      odoo: {
        "ir.model/search_count": () => 1,
        "helpdesk.team/search_read": () => ONE_TEAM,
      },
    },
  );
  const result = await listTeams(fb, { config: CONFIG });
  assert.deepEqual(result.teams, ONE_TEAM);
});

test("listHelpdeskTeams reports Odoo errors", async () => {
  const fb = await loadBackground(
    { ...CONFIG },
    {
      odoo: {
        "ir.model/search_count": () => {
          throw new Error("Access Denied");
        },
      },
    },
  );
  const result = await listTeams(fb);
  assert.equal(result.ok, false);
  assert.match(result.error, /Access Denied/);
});
