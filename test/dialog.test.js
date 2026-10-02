// Runs dialog.js (the popup window) in a fake DOM and checks what it sends
// back to the background when a button is clicked.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createFakeBrowser, settle } from "./helpers/fakeBrowser.js";
import { documentFromHtml } from "./helpers/fakeDom.js";

const HTML = readFileSync(new URL("../dialog.html", import.meta.url), "utf8");
const SOURCES = ["../lib/domUtils.js", "../dialog.js"].map((p) =>
  readFileSync(new URL(p, import.meta.url), "utf8"),
);

async function openDialogPage({ message = "Hi", buttons = [], selects }) {
  const fb = createFakeBrowser();
  fb.browser.windows.getCurrent = async () => ({ id: 42 });
  const params = new URLSearchParams({
    title: "Odoo Email Connector",
    message,
    buttons: JSON.stringify(buttons),
  });
  if (selects) params.set("selects", JSON.stringify(selects));
  const document = documentFromHtml(HTML);
  let closed = false;
  const context = {
    browser: fb.browser,
    document,
    console,
    location: { search: "?" + params },
    URLSearchParams,
    close: () => (closed = true),
  };
  context.window = context;
  vm.createContext(context);
  for (const src of SOURCES) vm.runInContext(src, context);
  await settle();
  const buttonEls = document.query((el) => el.tagName === "BUTTON");
  return { ...fb, document, buttonEls, isClosed: () => closed };
}

const IMPORT_BUTTONS = [
  { title: "As Ticket (Helpdesk)", value: "helpdesk.ticket" },
  { title: "As Opportunity (CRM Lead)", value: "crm.lead" },
];
const TEAM_SELECT = {
  id: "team",
  label: "Helpdesk team (for tickets)",
  options: [
    { value: "", label: "Default team" },
    { value: "3", label: "Customer Care" },
    { value: "7", label: "Support" },
  ],
  selected: "7",
};

test("a dialog without selects sends the button value as before", async () => {
  const page = await openDialogPage({ buttons: IMPORT_BUTTONS.slice(1) });
  assert.equal(page.document.query((el) => el.tagName === "SELECT").length, 0);
  await page.buttonEls[0].click();
  assert.deepEqual(page.sentMessages, [
    { action: "dialogChoice", windowId: 42, choice: "crm.lead", values: {} },
  ]);
  assert.equal(page.isClosed(), true);
});

test("the team select is shown with the preselected team", async () => {
  const page = await openDialogPage({
    buttons: IMPORT_BUTTONS,
    selects: [TEAM_SELECT],
  });
  const select = page.document.getElementById("select-team");
  assert.deepEqual(
    select.options.map((o) => [o.value, o.textContent]),
    [
      ["", "Default team"],
      ["3", "Customer Care"],
      ["7", "Support"],
    ],
  );
  assert.equal(select.value, "7");
  assert.match(
    select.parentElement.textContent,
    /^Helpdesk team \(for tickets\):/,
  );
});

test("the selected team is sent with the clicked button", async () => {
  const page = await openDialogPage({
    buttons: IMPORT_BUTTONS,
    selects: [TEAM_SELECT],
  });
  page.document.getElementById("select-team").value = "3";
  await page.buttonEls[0].click();
  assert.deepEqual(page.sentMessages[0], {
    action: "dialogChoice",
    windowId: 42,
    choice: "helpdesk.ticket",
    values: { team: "3" },
  });
});

test("a dialog without buttons shows OK", async () => {
  const page = await openDialogPage({ message: "Odoo error" });
  assert.deepEqual(
    page.buttonEls.map((b) => b.textContent),
    ["OK"],
  );
});
