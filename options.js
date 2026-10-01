const { toTeamId } = globalThis.OdooImportChoice;

// Status text colors for the options page.
const OK_COLOR = "green";
const ERROR_COLOR = "#c0392b";

const urlInput = document.getElementById("url");
const dbInput = document.getElementById("db");
const apiKeyInput = document.getElementById("apikey");
const testBtn = document.getElementById("test");
const testStatus = document.getElementById("testStatus");
const saveBtn = document.getElementById("save");
const clearCacheBtn = document.getElementById("clearCache");
const status = document.getElementById("status");

const maxAgeInput = document.getElementById("maxAgeDays");
const syncLimitInput = document.getElementById("syncLimit");
const saveSyncBtn = document.getElementById("saveSync");
const syncNowBtn = document.getElementById("syncNow");
const countBtn = document.getElementById("countBtn");
const countResult = document.getElementById("countResult");
const cacheInfo = document.getElementById("cacheInfo");

const helpdeskTeamIdInput = document.getElementById("helpdeskTeamId");
const loadTeamsBtn = document.getElementById("loadTeams");
const loadTeamsStatus = document.getElementById("loadTeamsStatus");
const rewriteDeliveredToInput = document.getElementById("rewriteDeliveredTo");
const saveTicketBtn = document.getElementById("saveTicket");
const ticketStatus = document.getElementById("ticketStatus");
const helpdeskNote = document.getElementById("helpdeskNote");

const syncSettingsForm = document.getElementById("syncSettings");
const syncFields = [
  maxAgeInput,
  syncLimitInput,
  saveSyncBtn,
  clearCacheBtn,
  syncNowBtn,
  countBtn,
  syncSettingsForm,
  helpdeskTeamIdInput,
  loadTeamsBtn,
  rewriteDeliveredToInput,
  saveTicketBtn,
];
let syncEnabled = false;
// Helpdesk counts as available once teams were loaded (see
// lib/importChoice.js); until then its options are shown greyed out.
let helpdeskAvailable = false;
// Connection identity (URL, API key, database) the cached teams belong to.
let savedConnectionHash = null;
// Teams fetched by "Test connection" for a connection that is not saved yet,
// staged until that connection is saved ({ hash, teams, teamId }).
let pendingHelpdesk = null;

function setSyncEnabled(enabled) {
  syncEnabled = enabled;
  syncFields.forEach((el) => {
    if (el) el.disabled = !enabled;
  });
  applyHelpdeskAvailability();
}

function applyHelpdeskAvailability() {
  helpdeskTeamIdInput.disabled = !syncEnabled || !helpdeskAvailable;
  helpdeskNote.textContent = helpdeskAvailable
    ? ""
    : "Helpdesk is not available: no Helpdesk teams loaded from Odoo. " +
      'Ticket import and the Helpdesk team stay disabled until "Load teams ' +
      'from Odoo" finds Helpdesk teams.';
}

let lastValidHash = null;

function getConfig() {
  return {
    url: urlInput.value.trim(),
    apikey: apiKeyInput.value.trim(),
    db: dbInput.value.trim() || null,
  };
}

function hash(cfg) {
  return JSON.stringify(cfg);
}

function invalidate() {
  lastValidHash = null;
  saveBtn.disabled = true;
  testStatus.textContent = "";
  setSyncEnabled(false);
}

(async () => {
  const stored = await browser.storage.local.get([
    "url",
    "db",
    "apikey",
    "maxAgeDays",
    "syncLimit",
    "helpdeskTeamId",
    "helpdeskTeams",
    "rewriteDeliveredTo",
  ]);
  if (stored.url) urlInput.value = stored.url;
  if (stored.db) dbInput.value = stored.db;
  if (stored.apikey) apiKeyInput.value = stored.apikey;
  if (stored.maxAgeDays !== undefined) maxAgeInput.value = stored.maxAgeDays;
  if (stored.syncLimit !== undefined) syncLimitInput.value = stored.syncLimit;
  rewriteDeliveredToInput.checked = stored.rewriteDeliveredTo === true;
  // Show the cached teams (and the saved team) right away, so saving before
  // the teams are (re)loaded from Odoo keeps the saved team.
  const cachedTeams = Array.isArray(stored.helpdeskTeams)
    ? stored.helpdeskTeams
    : [];
  fillTeamSelect(cachedTeams, stored.helpdeskTeamId);
  helpdeskAvailable = cachedTeams.length > 0;
  savedConnectionHash = hash({
    url: stored.url || "",
    apikey: stored.apikey || "",
    db: stored.db || null,
  });
  invalidate();
  if (stored.url && stored.apikey) setSyncEnabled(true);
  refreshCacheInfo();
})();

browser.storage.onChanged.addListener((changes, area) => {
  if (
    area === "local" &&
    ("odooMailCache" in changes || "lastOdooSync" in changes)
  ) {
    refreshCacheInfo();
  }
});

[urlInput, dbInput, apiKeyInput].forEach((el) =>
  el.addEventListener("input", invalidate),
);

testBtn.addEventListener("click", async () => {
  const cfg = getConfig();

  if (!cfg.url || !cfg.apikey) {
    testStatus.textContent = "URL and API key are required";
    testStatus.style.color = ERROR_COLOR;
    return;
  }

  const granted = await browser.permissions.request({
    origins: ["*://*/*"],
  });
  if (!granted) {
    testStatus.textContent = "Host permission is required";
    testStatus.style.color = ERROR_COLOR;
    return;
  }
  console.debug("testConnection: host permission granted");

  testStatus.textContent = "Testing…";
  testStatus.style.color = "";
  saveBtn.disabled = true;

  try {
    const result = await browser.runtime.sendMessage({
      action: "testConnection",
      config: cfg,
    });

    if (result?.ok) {
      lastValidHash = hash(cfg);
      saveBtn.disabled = false;
      const info = result.info;
      let text = "OK";
      if (info?.userInfo) {
        const u = info.userInfo;
        text += " as " + (u.login || "") + (u.name ? " (" + u.name + ")" : "");
      }
      testStatus.textContent = text;
      testStatus.style.color = OK_COLOR;
      // Also check whether Helpdesk is installed, so its options are only
      // selectable where they make sense.
      loadTeams(cfg);
    } else {
      testStatus.textContent = "Failed: " + (result?.error || "unknown error");
      testStatus.style.color = ERROR_COLOR;
    }
  } catch (err) {
    // sendMessage rejects when the background throws (e.g. an unreachable
    // URL); without this the status would stay at "Testing…".
    testStatus.textContent = "Failed: " + (err?.message || err);
    testStatus.style.color = ERROR_COLOR;
  }
});

clearCacheBtn.addEventListener("click", async () => {
  const result = await browser.runtime.sendMessage({ action: "clearCache" });
  status.textContent = result?.ok
    ? "Odoo cache cleared"
    : "Failed to clear cache";
  refreshCacheInfo();
});

/**
 * Fills the "Default Helpdesk Team" select. A selected team that is not in
 * the list (teams not loaded yet, or removed in Odoo) is kept as an extra
 * option, so saving the form never drops it silently.
 */
function fillTeamSelect(teams, selected) {
  const wanted =
    selected !== undefined && selected !== null && selected !== ""
      ? String(selected)
      : "";
  helpdeskTeamIdInput.innerHTML = "";
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "— not set —";
  helpdeskTeamIdInput.appendChild(noneOpt);
  for (const team of teams) {
    const opt = document.createElement("option");
    opt.value = String(team.id);
    opt.textContent = team.name;
    helpdeskTeamIdInput.appendChild(opt);
  }
  if (wanted && !teams.some((t) => String(t.id) === wanted)) {
    const opt = document.createElement("option");
    opt.value = wanted;
    opt.textContent = "Team #" + wanted + " (not in the loaded teams)";
    helpdeskTeamIdInput.appendChild(opt);
  }
  helpdeskTeamIdInput.value = wanted;
}

/**
 * Reads the Helpdesk teams from Odoo and caches them. `config` is passed by
 * "Test connection" to check settings that are not saved yet.
 */
async function loadTeams(config) {
  const wanted = helpdeskTeamIdInput.value;
  loadTeamsStatus.textContent = "Loading…";
  loadTeamsStatus.style.color = "";
  loadTeamsBtn.disabled = true;
  try {
    const msg = { action: "listHelpdeskTeams" };
    if (config) msg.config = config;
    const result = await browser.runtime.sendMessage(msg);
    if (!result?.ok) throw new Error(result?.error || "unknown error");
    fillTeamSelect(result.teams, wanted);
    const testedHash = config ? hash(config) : savedConnectionHash;
    if (config && testedHash !== savedConnectionHash) {
      // "Test connection" for a connection that is not saved yet: stage the
      // teams, so imports keep using the saved connection's teams until this
      // one is saved (one connection's teams never leak into another).
      pendingHelpdesk = {
        hash: testedHash,
        teams: result.teams,
        teamId:
          pendingHelpdesk?.hash === testedHash
            ? pendingHelpdesk.teamId
            : undefined,
      };
    } else {
      // Teams for the saved connection ("Load teams from Odoo", or a Test
      // connection of the saved settings). Cached so the import dialog and
      // the status bar "Add" control can offer the teams without calling
      // Odoo on every click. An empty list (Helpdesk not installed) disables
      // the Ticket import. Only write when the list changed, so a repeated
      // "Test connection" does not churn storage.onChanged (which re-renders
      // the status bar).
      const stored = await browser.storage.local.get("helpdeskTeams");
      if (
        JSON.stringify(stored.helpdeskTeams) !== JSON.stringify(result.teams)
      ) {
        await browser.storage.local.set({ helpdeskTeams: result.teams });
      }
    }
    helpdeskAvailable = result.teams.length > 0;
    applyHelpdeskAvailability();
    if (result.available === false) {
      loadTeamsStatus.textContent = "Helpdesk is not installed in Odoo";
      loadTeamsStatus.style.color = "";
    } else {
      loadTeamsStatus.textContent =
        result.teams.length + (result.teams.length === 1 ? " team" : " teams");
      loadTeamsStatus.style.color = OK_COLOR;
    }
  } catch (err) {
    loadTeamsStatus.textContent = "Failed: " + err.message;
    loadTeamsStatus.style.color = ERROR_COLOR;
  } finally {
    loadTeamsBtn.disabled = !syncEnabled;
  }
}

loadTeamsBtn.addEventListener("click", () => loadTeams());

saveTicketBtn.addEventListener("click", async () => {
  try {
    const teamId = toTeamId(helpdeskTeamIdInput.value);
    const toRemove = [];
    const toSet = { rewriteDeliveredTo: rewriteDeliveredToInput.checked };
    if (teamId === null) toRemove.push("helpdeskTeamId");
    else toSet.helpdeskTeamId = teamId;
    if (toRemove.length) await browser.storage.local.remove(toRemove);
    await browser.storage.local.set(toSet);
    ticketStatus.textContent = "Saved";
    ticketStatus.style.color = OK_COLOR;
  } catch (err) {
    ticketStatus.textContent = "Failed: " + err.message;
    ticketStatus.style.color = ERROR_COLOR;
  }
});

document.getElementById("settings").addEventListener("submit", async (e) => {
  e.preventDefault();

  const cfg = getConfig();
  if (hash(cfg) !== lastValidHash) {
    status.textContent = "Please test before saving";
    return;
  }

  const nextHash = hash(cfg);
  await browser.storage.local.set(cfg);

  if (nextHash !== savedConnectionHash) {
    // The connection changed: the cached teams belonged to the old one. Use
    // the teams staged for this connection by "Test connection", if any, and
    // drop them otherwise (they would point at teams of another server).
    const pending = pendingHelpdesk?.hash === nextHash ? pendingHelpdesk : null;
    const toSet = {};
    const toRemove = [];
    if (pending) {
      toSet.helpdeskTeams = pending.teams;
      if (pending.teamId != null) toSet.helpdeskTeamId = pending.teamId;
      else toRemove.push("helpdeskTeamId");
    } else {
      toRemove.push("helpdeskTeams", "helpdeskTeamId");
    }
    if (toRemove.length) await browser.storage.local.remove(toRemove);
    if (Object.keys(toSet).length) await browser.storage.local.set(toSet);
    savedConnectionHash = nextHash;
    fillTeamSelect(pending ? pending.teams : [], pending?.teamId ?? "");
    helpdeskAvailable = !!pending && pending.teams.length > 0;
    applyHelpdeskAvailability();
  }
  pendingHelpdesk = null;

  const result = await browser.runtime.sendMessage({
    action: "setup",
  });

  if (result?.ok) {
    status.textContent = "Settings saved";
    setSyncEnabled(true);
  } else {
    status.textContent =
      "Saved, but setup failed: " + (result?.error || "unknown error");
  }
});

saveSyncBtn.addEventListener("click", async () => {
  const raw = parseInt(maxAgeInput.value, 10);
  const maxAgeDays = Number.isNaN(raw) ? 365 : Math.max(0, raw);
  const rawLimit = parseInt(syncLimitInput.value, 10);
  const syncLimit = Number.isNaN(rawLimit) ? 0 : Math.max(0, rawLimit);
  await browser.storage.local.set({ maxAgeDays, syncLimit });
  status.textContent = "Sync settings saved";
  refreshCacheInfo();
});

countBtn.addEventListener("click", async () => {
  countBtn.disabled = true;
  countResult.textContent = "Counting…";
  const raw = parseInt(maxAgeInput.value, 10);
  const maxAgeDays = Number.isNaN(raw) ? 365 : Math.max(0, raw);
  const result = await browser.runtime.sendMessage({
    action: "countOdooMessages",
    maxAgeDays,
  });
  countResult.textContent = result?.ok
    ? result.count + " messages"
    : "Error: " + (result?.error || "unknown");
  countBtn.disabled = false;
});

syncNowBtn.addEventListener("click", async () => {
  syncNowBtn.disabled = true;
  status.textContent = "Syncing…";
  const result = await browser.runtime.sendMessage({ action: "syncFromOdoo" });
  status.textContent = result?.ok ? "Sync complete" : "Sync failed";
  syncNowBtn.disabled = false;
  refreshCacheInfo();
});

async function refreshCacheInfo() {
  const info = await browser.runtime.sendMessage({ action: "getCacheInfo" });
  if (!info) return;
  let text = "Cached entries: " + info.size;
  if (info.lastSync) {
    const d = new Date(info.lastSync);
    text += " | Last sync: " + d.toLocaleString();
  }
  cacheInfo.textContent = text;
}
