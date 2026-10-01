import { test } from "node:test";
import assert from "node:assert/strict";
import "../lib/importChoice.js";

const {
  getImportModelChoices,
  getModelLabel,
  getTeamChoices,
  isHelpdeskAvailable,
  resolveImportModel,
  resolveTeamId,
  toTeamId,
} = globalThis.OdooImportChoice;

const TEAMS = [
  { id: 3, name: "Customer Care" },
  { id: 7, name: "Support" },
];

test("isHelpdeskAvailable is false without cached teams", () => {
  assert.equal(isHelpdeskAvailable({}), false);
  assert.equal(isHelpdeskAvailable({ helpdeskTeams: [] }), false);
  assert.equal(isHelpdeskAvailable({ helpdeskTeams: "bogus" }), false);
  assert.equal(isHelpdeskAvailable({ helpdeskTeams: TEAMS }), true);
});

test("resolveImportModel uses the explicit choice", () => {
  const cfg = { helpdeskTeams: TEAMS };
  assert.equal(resolveImportModel({ model: "generic" }, cfg), "generic");
  assert.equal(resolveImportModel({ model: "crm.lead" }, cfg), "crm.lead");
  assert.equal(
    resolveImportModel({ model: "helpdesk.ticket" }, cfg),
    "helpdesk.ticket",
  );
});

test("resolveImportModel falls back to Opportunity without a valid choice", () => {
  const cfg = { helpdeskTeams: TEAMS };
  assert.equal(resolveImportModel({}, cfg), "crm.lead");
  assert.equal(resolveImportModel(undefined, cfg), "crm.lead");
  assert.equal(resolveImportModel({ model: "bogus" }, cfg), "crm.lead");
});

test("resolveImportModel never picks Ticket without Helpdesk", () => {
  assert.equal(
    resolveImportModel({ model: "helpdesk.ticket" }, {}),
    "crm.lead",
  );
});

test("resolveTeamId prefers the explicit team", () => {
  const cfg = { helpdeskTeamId: 3, helpdeskTeams: TEAMS };
  assert.equal(resolveTeamId({ teamId: "7" }, cfg), 7);
  assert.equal(resolveTeamId({ teamId: 7 }, cfg), 7);
});

test("resolveTeamId uses the configured default before the first cached team", () => {
  assert.equal(
    resolveTeamId({}, { helpdeskTeamId: 7, helpdeskTeams: TEAMS }),
    7,
  );
  assert.equal(
    resolveTeamId({ teamId: "" }, { helpdeskTeamId: 7, helpdeskTeams: TEAMS }),
    7,
  );
});

test("resolveTeamId leaves the team to Odoo when none is configured", () => {
  assert.equal(resolveTeamId({}, { helpdeskTeams: TEAMS }), null);
  assert.equal(resolveTeamId(undefined, {}), null);
  assert.equal(resolveTeamId({ teamId: "abc" }, {}), null);
});

test("resolveTeamId ignores a configured team missing from the cached teams", () => {
  assert.equal(
    resolveTeamId({}, { helpdeskTeamId: 99, helpdeskTeams: TEAMS }),
    null,
  );
});

test("resolveTeamId keeps the configured team when no teams are cached", () => {
  assert.equal(resolveTeamId({}, { helpdeskTeamId: 99 }), 99);
});

test("getTeamChoices offers no select with fewer than two teams", () => {
  assert.equal(getTeamChoices({}), null);
  assert.equal(getTeamChoices({ helpdeskTeams: [TEAMS[0]] }), null);
});

test("getTeamChoices starts with Default team when none is configured", () => {
  assert.deepEqual(getTeamChoices({ helpdeskTeams: TEAMS }), {
    options: [
      { value: "", label: "Default team" },
      { value: "3", label: "Customer Care" },
      { value: "7", label: "Support" },
    ],
    selected: "",
  });
});

test("getTeamChoices preselects the configured default team", () => {
  assert.deepEqual(
    getTeamChoices({ helpdeskTeams: TEAMS, helpdeskTeamId: 7 }),
    {
      options: [
        { value: "3", label: "Customer Care" },
        { value: "7", label: "Support" },
      ],
      selected: "7",
    },
  );
});

test("getTeamChoices ignores a configured team missing from the list", () => {
  const choices = getTeamChoices({ helpdeskTeams: TEAMS, helpdeskTeamId: 99 });
  assert.equal(choices.selected, "");
  assert.equal(choices.options[0].label, "Default team");
});

test("toTeamId keeps positive integers and rejects everything else", () => {
  assert.equal(toTeamId(7), 7);
  assert.equal(toTeamId("7"), 7);
  assert.equal(toTeamId(""), null);
  assert.equal(toTeamId("abc"), null);
  assert.equal(toTeamId(0), null);
  assert.equal(toTeamId(-3), null);
  assert.equal(toTeamId(undefined), null);
});

test("getImportModelChoices omits Ticket without Helpdesk", () => {
  assert.deepEqual(
    getImportModelChoices({}).map((c) => c.value),
    ["crm.lead", "generic"],
  );
});

test("getImportModelChoices puts Ticket first once Helpdesk is available", () => {
  assert.deepEqual(
    getImportModelChoices({ helpdeskTeams: TEAMS }).map((c) => c.value),
    ["helpdesk.ticket", "crm.lead", "generic"],
  );
});

test("getModelLabel returns the display label", () => {
  assert.equal(getModelLabel("helpdesk.ticket"), "Ticket (Helpdesk)");
  assert.equal(getModelLabel("crm.lead"), "Opportunity (CRM Lead)");
  assert.equal(getModelLabel("generic"), "Generic");
  assert.equal(getModelLabel("x.y"), "x.y");
});

test("resolveTeamId matches a configured team whose cached id is a string", () => {
  assert.equal(
    resolveTeamId(
      {},
      { helpdeskTeamId: 7, helpdeskTeams: [{ id: "7", name: "Support" }] },
    ),
    7,
  );
});
