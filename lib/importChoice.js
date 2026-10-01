// Decides which Odoo model (and, for tickets, which Helpdesk team) a new
// email is imported into. Kept free of browser APIs so it can be unit tested.
//
// Loaded both as a plain script (message display scripts, options page) and
// as an ES module (background, tests), so the API is published on globalThis.
// Module consumers import the file for its side effect and read
// globalThis.OdooImportChoice.
(function (root) {
  const MODEL_TICKET = "helpdesk.ticket";
  const MODEL_LEAD = "crm.lead";
  const MODEL_GENERIC = "generic";

  const MODEL_LABELS = {
    [MODEL_TICKET]: "Ticket (Helpdesk)",
    [MODEL_LEAD]: "Opportunity (CRM Lead)",
    [MODEL_GENERIC]: "Generic",
  };

  /**
   * Helpdesk teams cached by the Options page ("Load teams from Odoo").
   *
   * @param {Object} cfg stored configuration
   * @returns {Array<{id:number,name:string}>}
   */
  function getCachedTeams(cfg) {
    return Array.isArray(cfg?.helpdeskTeams) ? cfg.helpdeskTeams : [];
  }

  /**
   * Helpdesk counts as available once at least one team was loaded from Odoo.
   * Without it the add-on behaves as before (Opportunity / Generic only).
   */
  function isHelpdeskAvailable(cfg) {
    return getCachedTeams(cfg).length > 0;
  }

  /**
   * Model to import into: the explicit choice (dialog or status bar button).
   * Ticket needs Helpdesk; without a valid choice, Opportunity is used as
   * before.
   *
   * @param {{model?:string}|undefined} choice
   * @param {Object} cfg
   * @returns {string} one of MODEL_TICKET, MODEL_LEAD, MODEL_GENERIC
   */
  function resolveImportModel(choice, cfg) {
    const model = choice?.model;
    if (model === MODEL_TICKET && !isHelpdeskAvailable(cfg)) return MODEL_LEAD;
    if ([MODEL_TICKET, MODEL_LEAD, MODEL_GENERIC].includes(model)) return model;
    return MODEL_LEAD;
  }

  /**
   * Parses a positive integer id, or null.
   *
   * @param {number|string|undefined} value
   * @returns {number|null}
   */
  function toTeamId(value) {
    const id = parseInt(value, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  /**
   * Helpdesk team for a new ticket: the explicit choice, then the configured
   * "Default Helpdesk Team". Returns null to let Odoo pick its default team,
   * also when the configured team is no longer in the cached team list.
   *
   * @param {{teamId?:number|string}|undefined} choice
   * @param {Object} cfg
   * @returns {number|null}
   */
  function resolveTeamId(choice, cfg) {
    const explicit = toTeamId(choice?.teamId);
    if (explicit) return explicit;
    const configured = toTeamId(cfg?.helpdeskTeamId);
    if (!configured) return null;
    // No teams cached yet: keep the configured team (Helpdesk may simply not
    // have been loaded). Once teams are known, drop one that is gone in Odoo.
    const teams = getCachedTeams(cfg);
    if (teams.length && !teams.some((t) => t.id === configured)) return null;
    return configured;
  }

  /**
   * Options for a Helpdesk team select, or null when there is nothing to pick
   * (fewer than two teams). The configured default team is preselected; without
   * a valid one, a "Default team" entry (empty value, Odoo picks) comes first.
   *
   * @param {Object} cfg
   * @returns {{options:Array<{value:string,label:string}>, selected:string}|null}
   */
  function getTeamChoices(cfg) {
    const teams = getCachedTeams(cfg);
    if (teams.length < 2) return null;
    const configured = resolveTeamId(undefined, cfg);
    const options = teams.map((t) => ({ value: String(t.id), label: t.name }));
    if (!configured) options.unshift({ value: "", label: "Default team" });
    return { options, selected: configured ? String(configured) : "" };
  }

  /**
   * The import types offered for an email without an Odoo match, in menu
   * order. Ticket is only offered once Helpdesk is available.
   *
   * @param {Object} cfg
   * @returns {Array<{value:string,label:string,tooltip?:string}>}
   */
  function getImportModelChoices(cfg) {
    const choices = [
      { value: MODEL_LEAD, label: MODEL_LABELS[MODEL_LEAD] },
      {
        value: MODEL_GENERIC,
        label: MODEL_LABELS[MODEL_GENERIC],
        tooltip:
          "Might fail on Odoo 19 without Lost Messages module, see https://github.com/joergsteffens/thunderbird2odoo",
      },
    ];
    if (isHelpdeskAvailable(cfg)) {
      choices.unshift({
        value: MODEL_TICKET,
        label: MODEL_LABELS[MODEL_TICKET],
      });
    }
    return choices;
  }

  /**
   * Display label for a model (e.g. "Ticket (Helpdesk)"), used in menus and
   * result messages.
   *
   * @param {string} model one of MODEL_TICKET, MODEL_LEAD, MODEL_GENERIC
   * @returns {string}
   */
  function getModelLabel(model) {
    return MODEL_LABELS[model] || model;
  }

  root.OdooImportChoice = {
    MODEL_TICKET,
    MODEL_LEAD,
    MODEL_GENERIC,
    getCachedTeams,
    isHelpdeskAvailable,
    resolveImportModel,
    toTeamId,
    resolveTeamId,
    getTeamChoices,
    getImportModelChoices,
    getModelLabel,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
