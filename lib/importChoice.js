// Decides which Odoo model (and, for tickets, which Helpdesk team) a new
// email is imported into. Kept free of browser APIs so it can be unit tested.

export const MODEL_TICKET = "helpdesk.ticket";
export const MODEL_LEAD = "crm.lead";
export const MODEL_GENERIC = "generic";

/**
 * Helpdesk teams cached by the Options page ("Load teams from Odoo").
 *
 * @param {Object} cfg stored configuration
 * @returns {Array<{id:number,name:string}>}
 */
export function getCachedTeams(cfg) {
  return Array.isArray(cfg?.helpdeskTeams) ? cfg.helpdeskTeams : [];
}

/**
 * Helpdesk counts as available once at least one team was loaded from Odoo.
 * Without it the add-on behaves as before (Opportunity / Generic only).
 */
export function isHelpdeskAvailable(cfg) {
  return getCachedTeams(cfg).length > 0;
}

/**
 * Default model when the user did not pick one explicitly.
 *
 * A stored "helpdesk.ticket" default is ignored while Helpdesk is not
 * available, so a missing Helpdesk add-on never breaks the import.
 */
export function getDefaultImportModel(cfg) {
  const available = isHelpdeskAvailable(cfg);
  const stored = cfg?.defaultImportAs;
  if (stored === MODEL_LEAD || stored === MODEL_GENERIC) return stored;
  if (stored === MODEL_TICKET && available) return MODEL_TICKET;
  return available ? MODEL_TICKET : MODEL_LEAD;
}

/**
 * Model to import into: the explicit choice (menu entry or status bar
 * select) wins, otherwise the configured default.
 *
 * @param {{model?:string}|undefined} choice
 * @param {Object} cfg
 * @returns {string} one of MODEL_TICKET, MODEL_LEAD, MODEL_GENERIC
 */
export function resolveImportModel(choice, cfg) {
  const model = choice?.model;
  if ([MODEL_TICKET, MODEL_LEAD, MODEL_GENERIC].includes(model)) return model;
  return getDefaultImportModel(cfg);
}

function toTeamId(value) {
  const id = parseInt(value, 10);
  return (Number.isInteger(id) && id > 0) ? id : null;
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
export function resolveTeamId(choice, cfg) {
  const explicit = toTeamId(choice?.teamId);
  if (explicit) return explicit;
  const configured = toTeamId(cfg?.helpdeskTeamId);
  if (!configured) return null;
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
export function getTeamChoices(cfg) {
  const teams = getCachedTeams(cfg);
  if (teams.length < 2) return null;
  const configured = resolveTeamId(undefined, cfg);
  const options = teams.map((t) => ({ value: String(t.id), label: t.name }));
  if (!configured) options.unshift({ value: "", label: "Default team" });
  return { options, selected: configured ? String(configured) : "" };
}
