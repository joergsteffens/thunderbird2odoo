import { test } from "node:test";
import assert from "node:assert/strict";
import "../lib/importChoice.js";

const {
  getDefaultImportModel,
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

test("default model stays Opportunity for existing configs without Helpdesk", () => {
  assert.equal(getDefaultImportModel({}), "crm.lead");
  assert.equal(getDefaultImportModel(undefined), "crm.lead");
});

test("default model is Ticket once Helpdesk teams are loaded", () => {
  assert.equal(
    getDefaultImportModel({ helpdeskTeams: TEAMS }),
    "helpdesk.ticket",
  );
});

test("a stored Ticket default falls back to Opportunity without Helpdesk", () => {
  assert.equal(
    getDefaultImportModel({ defaultImportAs: "helpdesk.ticket" }),
    "crm.lead",
  );
  assert.equal(
    getDefaultImportModel({
      defaultImportAs: "helpdesk.ticket",
      helpdeskTeams: TEAMS,
    }),
    "helpdesk.ticket",
  );
});

test("stored Opportunity and Generic defaults are honored", () => {
  for (const m of ["crm.lead", "generic"]) {
    assert.equal(getDefaultImportModel({ defaultImportAs: m }), m);
    assert.equal(
      getDefaultImportModel({ defaultImportAs: m, helpdeskTeams: TEAMS }),
      m,
    );
  }
});

test("an unknown stored default is ignored", () => {
  assert.equal(getDefaultImportModel({ defaultImportAs: "x.y" }), "crm.lead");
});

test("resolveImportModel prefers the explicit choice", () => {
  const cfg = { defaultImportAs: "crm.lead", helpdeskTeams: TEAMS };
  assert.equal(resolveImportModel({ model: "generic" }, cfg), "generic");
  assert.equal(
    resolveImportModel({ model: "helpdesk.ticket" }, cfg),
    "helpdesk.ticket",
  );
  assert.equal(resolveImportModel({}, cfg), "crm.lead");
  assert.equal(resolveImportModel(undefined, cfg), "crm.lead");
  assert.equal(resolveImportModel({ model: "bogus" }, cfg), "crm.lead");
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
