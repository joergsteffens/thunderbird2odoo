/********************************************************************
 * Odoo Email Connector – Thunderbird MailExtension
 * Odoo >= 19
 ********************************************************************/

import {
  testOdooConnection,
  getConnectionInfo,
  findMail,
  findMails,
  normalizeUrl,
  searchMailMessages,
  countMailMessages,
  unifyMessageId,
  listHelpdeskTeams,
  isModelInstalled,
} from "./lib/odooClient.js";
import {
  uploadMail,
  decodeRawMail,
  rewriteDeliveredTo,
} from "./lib/odooMailUpload.js";
import {
  getCachedResult,
  setCachedResult,
  setCachedResults,
  clearAllCache,
  getCacheSize,
  getLastSync,
  setLastSync,
  CACHE_KEY,
} from "./lib/mailCache.js";
import { findPredecessor as findPredecessorIn } from "./lib/predecessor.js";
// lib/importChoice.js is a plain script (shared with the message display
// scripts), so it publishes its API on globalThis instead of exporting it.
import "./lib/importChoice.js";

const {
  MODEL_TICKET,
  MODEL_LEAD,
  MODEL_GENERIC,
  getTeamChoices,
  getImportModelChoices,
  getModelLabel,
  resolveImportModel,
  resolveTeamId,
} = globalThis.OdooImportChoice;

const MENU_ID_CONNECTOR = "odoo-connector";
const MENU_ID_IMPORT = "odoo-import";
const MENU_ID_VERIFY = "odoo-verify";
const MENU_ID_SYNC = "odoo-sync";

const menuIds = new Set();
menuIds
  .add(MENU_ID_CONNECTOR)
  .add(MENU_ID_IMPORT)
  .add(MENU_ID_VERIFY)
  .add(MENU_ID_SYNC);

const EN_DASH = "\u2013";

async function cacheFoundResult(entryId, model, resId, odooMessageId) {
  const entry = {
    status: "found",
    model: model || false,
    resId: resId || false,
    odooMessageId: odooMessageId || null,
    parentMessageId: null,
  };
  await setCachedResult(entryId, entry);
  return entry;
}

async function cacheParentFoundResult(entryId, parentMessageId) {
  const entry = {
    status: "parent_found",
    model: null,
    resId: null,
    odooMessageId: null,
    parentMessageId: parentMessageId,
  };
  await setCachedResult(entryId, entry);
  return entry;
}

async function cacheNotFoundResult(entryId) {
  const entry = {
    status: "not_found",
    model: null,
    resId: null,
    odooMessageId: null,
    parentMessageId: null,
  };
  await setCachedResult(entryId, entry);
  return entry;
}

function enrichEntry(cfg, entry) {
  if (!entry) return null;
  entry.baseUrl = normalizeUrl(cfg.url, "odoo");
  if (entry.odooMessageId)
    entry.messageSlug = normalizeUrl("mail.message", entry.odooMessageId);
  if (entry.model && entry.resId)
    entry.modelSlug = normalizeUrl(entry.model, entry.resId);
  return entry;
}

async function enrichWithParentUrl(cfg, entry) {
  if (!entry || !entry.parentMessageId) return entry;
  const parentEntry = await getCachedResult(entry.parentMessageId);
  if (parentEntry) {
    if (parentEntry.odooMessageId)
      entry.parentMessageSlug = normalizeUrl(
        "mail.message",
        parentEntry.odooMessageId,
      );
    if (parentEntry.model && parentEntry.resId)
      entry.parentModelSlug = normalizeUrl(
        parentEntry.model,
        parentEntry.resId,
      );
  }
  return entry;
}

async function enrichFull(cfg, entry) {
  if (!entry) return entry;
  enrichEntry(cfg, entry);
  return await enrichWithParentUrl(cfg, entry);
}

function getUrl(entry) {
  if (!entry) {
    return null;
  }
  if (entry.modelSlug) return normalizeUrl(entry.baseUrl, entry.modelSlug);
  if (entry.messageSlug) return normalizeUrl(entry.baseUrl, entry.messageSlug);
  if (entry.parentModelSlug)
    return normalizeUrl(entry.baseUrl, entry.parentModelSlug);
  if (entry.parentMessageSlug)
    return normalizeUrl(entry.baseUrl, entry.parentMessageSlug);
  return null;
}

function findPredecessor(cfg, pids) {
  return findPredecessorIn(cfg, pids, {
    findMails,
    getCachedResult,
    cacheFoundResult,
    cacheNotFoundResult,
  });
}

function notify(title, message, sticky = false) {
  console.debug(title + ": " + message);
  browser.notifications.create("thunderbird2odoo-" + Date.now(), {
    type: "basic",
    iconUrl: browser.runtime.getURL("icons/odoo-48.png"),
    title: title,
    message: message,
    ...(sticky ? { priority: 2 } : {}),
  });
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.warn("clipboard write failed:", err);
    return false;
  }
}

function buildNotification(prefix, r) {
  let title = "Odoo";
  let message = "";

  if (r.status === "found" && r.model && r.resId) {
    title = "Odoo – " + r.model + " " + (r.resId || "");
    message = prefix;
  } else {
    message =
      prefix + (r.odooMessageId ? " (message " + r.odooMessageId + ")" : "");
  }

  if (r.modelSlug) message += "\n" + normalizeUrl(r.baseUrl, r.modelSlug);
  if (r.messageSlug && r.messageSlug !== r.modelSlug)
    message += "\n" + normalizeUrl(r.baseUrl, r.messageSlug);

  return { title, message };
}

async function showResult(prefix, r, cfg, sticky = false) {
  enrichEntry(cfg, r);
  const n = buildNotification(prefix, r);
  let message = n.message;
  const url = r.modelSlug
    ? normalizeUrl(r.baseUrl, r.modelSlug)
    : r.messageSlug
      ? normalizeUrl(r.baseUrl, r.messageSlug)
      : null;
  if (url) {
    const copied = await copyToClipboard(url);
    if (copied) {
      message += "\nURL copied to clipboard";
    }
  }
  notify(n.title, message, sticky);
}

let _cachedConfig = null;

browser.storage.onChanged.addListener((changes, area) => {
  if (
    area === "local" &&
    [
      "url",
      "db",
      "apikey",
      "helpdeskTeamId",
      "helpdeskTeams",
      "defaultImportAs",
      "rewriteDeliveredTo",
    ].some((k) => k in changes)
  )
    _cachedConfig = null;
});

async function get_config() {
  if (_cachedConfig) return _cachedConfig;
  _cachedConfig = await browser.storage.local.get([
    "url",
    "db",
    "apikey",
    "helpdeskTeamId",
    "helpdeskTeams",
    "defaultImportAs",
    "rewriteDeliveredTo",
  ]);
  return _cachedConfig;
}

function errorResult(err) {
  return { ok: false, error: err.message };
}

async function requireConfig() {
  const cfg = await get_config();
  if (!cfg.url || !cfg.apikey) return null;
  return cfg;
}

async function findAndCache(cfg, id) {
  const result = await findMail(cfg, id);
  if (result.status === "found") {
    return await cacheFoundResult(
      id,
      result.model,
      result.resId,
      result.odooMessageId,
    );
  }
  return result;
}

async function setup() {
  browser.menus.removeAll();

  const cfg = await get_config();

  if (!cfg.url || !cfg.apikey) {
    return;
  }

  const hasPermission = await browser.permissions.contains({
    origins: ["*://*/*"],
  });
  if (hasPermission) {
    try {
      await testOdooConnection(cfg);
    } catch (err) {
      console.warn("setup: connection test failed, menus still created:", err);
    }
  } else {
    console.debug(
      "setup: host permission not granted yet, skipping connection test",
    );
  }

  const icon = {
    16: "icons/odoo-16.png",
    32: "icons/odoo-32.png",
    48: "icons/odoo-48.png",
    96: "icons/odoo-96.png",
    128: "icons/odoo-128.png",
  };

  browser.menus.create({
    id: MENU_ID_CONNECTOR,
    title: "Odoo Email Connector",
    contexts: ["message_list"],
    icons: icon,
  });

  browser.menus.create({
    id: MENU_ID_IMPORT,
    title: "Import this email",
    parentId: MENU_ID_CONNECTOR,
    contexts: ["message_list"],
    icons: icon,
  });

  browser.menus.create({
    id: MENU_ID_VERIFY,
    title: "Verify",
    parentId: MENU_ID_CONNECTOR,
    contexts: ["message_list"],
    icons: icon,
  });

  browser.menus.create({
    id: MENU_ID_SYNC,
    title: "Sync message status from Odoo",
    parentId: MENU_ID_CONNECTOR,
    contexts: ["message_list"],
    icons: icon,
  });
}

browser.menus.onShown.addListener((info) => {
  if (menuIds.size === 0) return;
  const selectedCount = info.selectedMessages?.messages?.length ?? 0;
  browser.menus.update(MENU_ID_CONNECTOR, { visible: selectedCount >= 1 });
  browser.menus.update(MENU_ID_IMPORT, { visible: selectedCount === 1 });
  browser.menus.update(MENU_ID_VERIFY, {
    visible: selectedCount >= 1,
    title:
      selectedCount > 1 ? "Verify " + selectedCount + " messages" : "Verify",
  });
  browser.menus.update(MENU_ID_SYNC, { visible: true });
  browser.menus.refresh();
});

function getMessageIdFromRaw(raw) {
  const match = raw.match(/^Message-ID:\s*<([^>]+)>/im);
  return match ? match[1] : null;
}

function collectPredecessorIds(inReplyToRaw, referencesRaw) {
  const ids = [];
  if (inReplyToRaw) {
    const match = inReplyToRaw.match(/<[^>]+>/);
    if (match) ids.push(unifyMessageId(match[0]));
  }
  if (referencesRaw) {
    const refIds = referencesRaw.match(/<[^>]+>/g);
    if (refIds) {
      for (let i = refIds.length - 1; i >= 0; i--) {
        const id = unifyMessageId(refIds[i]);
        if (!ids.includes(id)) ids.push(id);
      }
    }
  }
  return ids;
}

function extractPredecessorIds(decoded) {
  const irtMatch = decoded.match(/^In-Reply-To:\s*<([^>]+)>/im);
  const inReplyTo = irtMatch ? "<" + irtMatch[1] + ">" : null;
  const refsMatch = decoded.match(/^References:\s*((?:.+(?:\r?\n[ \t].+)*))/im);
  const references = refsMatch
    ? refsMatch[1].replace(/\r?\n[ \t]+/g, " ")
    : null;
  return collectPredecessorIds(inReplyTo, references);
}

function extractPredecessorIdsFromHeaders(headers) {
  const irt = headers["in-reply-to"];
  const inReplyTo = irt?.[0] || null;
  const refs = headers["references"];
  const references = refs?.[0] || null;
  return collectPredecessorIds(inReplyTo, references);
}

async function getHeaders(messageId) {
  const full = await messenger.messages.getFull(messageId);
  return full.headers;
}

async function showDialog(title, message, buttons = []) {
  return (await openDialog(title, message, buttons)).choice;
}

/**
 * Opens dialog.html and waits for a button click.
 *
 * @param {Array<{title:string,value:*,tooltip?:string}>} buttons
 * @param {Array<{id:string,label:string,options:Array<{value:string,label:string}>,selected?:string}>} selects
 *   optional <select> fields shown above the buttons
 * @returns {Promise<{choice:*, values:Object<string,string>}>} the clicked
 *   button's value (-1 if the window was closed) and the select values
 */
async function openDialog(title, message, buttons = [], selects = []) {
  const params = new URLSearchParams({
    title,
    message,
    buttons: JSON.stringify(buttons),
  });
  if (selects.length) params.set("selects", JSON.stringify(selects));
  const url = browser.runtime.getURL("dialog.html?" + params);
  const win = await browser.windows.create({
    url: url,
    type: "popup",
    width: 600,
    height: 360 + selects.length * 70,
  });
  let done = false;
  return new Promise((resolve) => {
    const cleanup = () => {
      if (done) return;
      done = true;
      browser.runtime.onMessage.removeListener(msgListener);
      browser.windows.onRemoved.removeListener(closeListener);
    };
    const msgListener = (msg) => {
      if (msg.action === "dialogChoice" && msg.windowId === win.id) {
        cleanup();
        resolve({ choice: msg.choice, values: msg.values || {} });
      }
    };
    const closeListener = (windowId) => {
      if (windowId === win.id) {
        cleanup();
        resolve({ choice: -1, values: {} });
      }
    };
    browser.runtime.onMessage.addListener(msgListener);
    browser.windows.onRemoved.addListener(closeListener);
  });
}

/**
 * Asks how to import an email that is not in Odoo and has no predecessor
 * there. Offers Opportunity and Generic as before; Ticket (and, with several
 * teams, a team select) only once Helpdesk teams were loaded.
 *
 * @returns {Promise<{model:string, teamId?:string}|null>} null if closed
 */
async function askImportChoice(cfg) {
  const buttons = getImportModelChoices(cfg).map((c) => {
    const button = {
      title: c.value === MODEL_GENERIC ? c.label : "As " + c.label,
      value: c.value,
    };
    if (c.value === MODEL_GENERIC)
      button.tooltip =
        "Might fail on Odoo 19 without Lost Messages module, see https://github.com/joergsteffens/thunderbird2odoo";
    return button;
  });
  const selects = [];
  const teams = getTeamChoices(cfg);
  if (teams) {
    selects.push({
      id: "team",
      label: "Helpdesk team (for tickets)",
      ...teams,
    });
  }
  const { choice, values } = await openDialog(
    "Odoo Email Connector",
    "This email and its predecessor are not in Odoo. How do you want to import it?",
    buttons,
    selects,
  );
  if (![MODEL_TICKET, MODEL_LEAD, MODEL_GENERIC].includes(choice)) return null;
  const result = { model: choice };
  if (choice === MODEL_TICKET && values.team) result.teamId = values.team;
  return result;
}

async function importMessageById(tbMessageId, choice = null) {
  const hasPermission = await browser.permissions.contains({
    origins: ["*://*/*"],
  });
  if (!hasPermission) {
    throw new Error(
      "Host permission not granted. Open the add-on options and click 'Test connection' to grant access.",
    );
  }

  const rawMail = await messenger.messages.getRaw(tbMessageId);
  const mid = getMessageIdFromRaw(rawMail);
  if (!mid) throw new Error("Could not extract Message-Id from email");
  console.debug("importMessageById: Message-Id=" + mid);
  const decoded = decodeRawMail(rawMail);

  const cfg = await requireConfig();
  if (!cfg) throw new Error("Not configured");

  // Step 1: Find email in Odoo
  const result = await findAndCache(cfg, mid);
  if (result.status === "found") {
    await showResult("Email found in Odoo", result, cfg, true);
    return mid;
  }

  // Step 2: Check predecessor(s) from In-Reply-To / References
  const predecessorIds = extractPredecessorIds(decoded);
  const predFound = await findPredecessor(cfg, predecessorIds);
  if (predFound) {
    await cacheParentFoundResult(mid, predFound.messageId);
    enrichEntry(cfg, predFound.entry);
    const url = getUrl(predFound.entry);
    const btnIdx = await showDialog(
      "Odoo Email Connector",
      "Predecessor email found" +
        (url ? " at " + url : "") +
        ". Import this email?",
      [{ title: "Import", value: 0 }],
    );
    if (btnIdx === 0) {
      await uploadAndShowResult(cfg, false, "Email imported", decoded, mid);
    }
    return mid;
  }

  // Step 3: No predecessor found. The status bar sends the model (and
  // team) picked in its "Import as" control; otherwise ask in a dialog.
  await cacheNotFoundResult(mid);

  if (!choice?.model) choice = await askImportChoice(cfg);
  if (!choice) return mid;

  const model = resolveImportModel(choice, cfg);
  const importedAs = "Email imported as " + getModelLabel(model);
  if (model === MODEL_TICKET) {
    const teamId = resolveTeamId(choice, cfg);
    const customValues = teamId ? { team_id: teamId } : null;
    await uploadAndShowResult(
      cfg,
      MODEL_TICKET,
      importedAs,
      decoded,
      mid,
      customValues,
    );
  } else if (model === MODEL_LEAD) {
    await uploadAndShowResult(cfg, MODEL_LEAD, importedAs, decoded, mid);
  } else {
    await uploadAndShowResult(cfg, false, importedAs, decoded, mid);
  }
  return mid;
}

async function verifyMessageById(tbMessageId) {
  const cfg = await get_config();
  const msg = await messenger.messages.get(tbMessageId);
  const mid = unifyMessageId(msg.headerMessageId);
  if (!mid) return null;

  const result = await findAndCache(cfg, mid);
  console.debug("verifyMessageById: findMail result=" + JSON.stringify(result));
  if (result.status === "found") {
    return result;
  }

  const headers = await getHeaders(tbMessageId);
  const predecessorIds = extractPredecessorIdsFromHeaders(headers);
  const predFound = await findPredecessor(cfg, predecessorIds);
  if (predFound) {
    console.debug(
      "verifyMessageById: predFound.messageId=" + predFound.messageId,
    );
    return await cacheParentFoundResult(mid, predFound.messageId);
  }
  console.debug("verifyMessageById: not found, caching as not_found");
  return await cacheNotFoundResult(mid);
}

async function uploadAndShowResult(
  cfg,
  model,
  prefix,
  decoded,
  messageId,
  customValues = null,
) {
  // Opt-in (Options page): see rewriteDeliveredTo() for the reason.
  const message = cfg.rewriteDeliveredTo
    ? rewriteDeliveredTo(decoded)
    : decoded;
  const rawResult = await uploadMail(cfg, message, model, customValues);
  console.debug("uploadAndShowResult: rawResult=" + JSON.stringify(rawResult));

  if (rawResult) {
    // message_process returned a thread_id — email was routed successfully.
    let found = null;
    if (messageId) {
      try {
        found = await findAndCache(cfg, messageId);
      } catch (err) {
        console.debug("uploadAndShowResult: findMail failed:", err);
      }
    }
    if (found?.status === "found") {
      await showResult(prefix, found, cfg, true);
    } else {
      // Odoo queued the mail but hasn't indexed it yet — cache with what we have
      if (messageId) await cacheFoundResult(messageId, model, rawResult, null);
      const r = {
        status: "found",
        model,
        resId: rawResult,
        odooMessageId: null,
      };
      await showResult(prefix, r, cfg, true);
    }
  } else if (rawResult === false) {
    if (messageId) {
      let found = null;
      try {
        found = await findAndCache(cfg, messageId);
      } catch (err) {
        console.debug("uploadAndShowResult: findMail failed:", err);
      }
      if (found?.status === "found") {
        await showResult("Email already in Odoo (duplicate)", found, cfg, true);
        return;
      }
      if (found !== null) await cacheNotFoundResult(messageId);
    }
    notify(
      "Odoo",
      "Email not imported: Odoo could not route this email to any model",
    );
  } else {
    notify(
      "Odoo",
      "Email not imported: ignored by Odoo (loop detection or bounce)",
    );
  }
}

async function handleOdooImporter(info) {
  try {
    const message = info.selectedMessages?.messages?.[0];
    if (!message) throw new Error("Select exactly one email");
    await importMessageById(message.id);
  } catch (err) {
    await showDialog("Odoo – Error", err.message);
  }
}

async function verifyMessages(tbMessageIds) {
  const cfg = await get_config();
  const entries = [];
  for (const id of tbMessageIds) {
    const m = await messenger.messages.get(id);
    const mid = unifyMessageId(m.headerMessageId);
    if (mid) entries.push({ tbId: id, mid });
  }
  if (entries.length === 0) return;

  const found = await findMails(
    cfg,
    entries.map((e) => e.mid),
  );
  for (const e of entries) {
    const r = found[e.mid];
    if (r) {
      await cacheFoundResult(e.mid, r.model, r.resId, r.odooMessageId);
    } else {
      const headers = await getHeaders(e.tbId);
      const predecessorIds = extractPredecessorIdsFromHeaders(headers);
      const predFound = await findPredecessor(cfg, predecessorIds);
      if (predFound) {
        await cacheParentFoundResult(e.mid, predFound.messageId);
      } else {
        await cacheNotFoundResult(e.mid);
      }
    }
  }
}

browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_ID_IMPORT) {
    await handleOdooImporter(info);
  } else if (info.menuItemId === MENU_ID_VERIFY) {
    const messages = info.selectedMessages?.messages;
    if (!messages?.length) return;
    notify("Odoo", "Verifying " + messages.length + " messages…");
    await verifyMessages(messages.map((m) => m.id));
    if (tab?.id) {
      try {
        const displayed = await messenger.messageDisplay.getDisplayedMessage(
          tab.id,
        );
        if (displayed) {
          const inSelection = messages.some(function (m) {
            return m.id === displayed.id;
          });
          if (!inSelection) await verifyMessageById(displayed.id);
        }
      } catch (err) {
        console.debug(
          "right-click verify: error checking displayed message:",
          err,
        );
      }
    }
    notify("Odoo", "Verify complete for " + messages.length + " messages");
  } else if (info.menuItemId === MENU_ID_SYNC) {
    await syncFromOdoo();
  }
  if (tab?.id) {
    browser.tabs
      .sendMessage(tab.id, { action: "refreshOdooStatus" })
      .catch(function () {});
  }
});

async function getSenderTabMessageId(sender) {
  if (!sender?.tab?.id) return null;
  const message = await messenger.messageDisplay.getDisplayedMessage(
    sender.tab.id,
  );
  return message?.id ?? null;
}

function ago(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function calcSinceDate(maxAgeDays) {
  return maxAgeDays > 0 ? ago(maxAgeDays) : null;
}

async function syncFromOdoo(forceFull = false) {
  const cfg = await requireConfig();
  if (!cfg) return { ok: false, error: "Addon not configured" };
  const prefs = await browser.storage.local.get(["maxAgeDays", "syncLimit"]);
  const maxAgeDays = prefs.maxAgeDays ?? 365;
  const syncLimit = prefs.syncLimit ?? 10000;

  let since;
  if (forceFull) {
    since = calcSinceDate(maxAgeDays);
  } else {
    const lastSync = await getLastSync();
    if (lastSync) {
      // set since to lastSync - 1 day.
      since = new Date(lastSync);
      since.setDate(since.getDate() - 1);
    } else {
      since = calcSinceDate(maxAgeDays);
    }
  }

  let count = 0;
  try {
    const estimated = await countMailMessages(cfg, since);
    const sinceLabel = since
      ? "since " + since.toISOString().slice(0, 10)
      : "all";
    notify(
      "Odoo",
      "Syncing from Odoo (" + sinceLabel + "): " + estimated + " messages…",
    );

    const results = await searchMailMessages(cfg, since, syncLimit);
    const entries = {};
    for (const msg of results) {
      if (!msg.message_id) continue;
      entries[unifyMessageId(String(msg.message_id))] = {
        status: "found",
        model: msg.model || false,
        resId: msg.res_id || false,
        odooMessageId: msg.id || null,
        parentMessageId: null,
      };
      count++;
    }
    await setCachedResults(entries);
    const truncated = syncLimit !== 0 && results.length >= syncLimit;
    if (!truncated) await setLastSync(new Date().toISOString());
    const total = await getCacheSize();
    let msg =
      count + " messages retrieved from Odoo. Total cache size: " + total + ".";
    if (truncated) msg += " (truncated, not all results fetched)";
    notify("Odoo", msg);
    return { ok: true, count, truncated };
  } catch (err) {
    notify("Odoo " + EN_DASH + " Error", "Sync failed: " + err.message);
    return errorResult(err);
  }
}

async function handleGetOdooStatus(sender) {
  try {
    const msgId = await getSenderTabMessageId(sender);
    if (!msgId) {
      console.debug("getOdooStatus: no msgId");
      return null;
    }
    const m = await messenger.messages.get(msgId);
    const mid = unifyMessageId(m.headerMessageId);
    if (!mid) {
      console.debug("getOdooStatus: no message_id in email");
      return null;
    }
    console.debug("getOdooStatus: mid=" + mid);
    let entry = await getCachedResult(mid);
    if (!entry) {
      const headers = await getHeaders(msgId);
      const pids = extractPredecessorIdsFromHeaders(headers);
      for (const pid of pids) {
        const parentEntry = await getCachedResult(pid);
        if (parentEntry?.status === "found") {
          entry = await cacheParentFoundResult(mid, pid);
          break;
        }
      }
    }
    if (!entry) {
      console.debug("getOdooStatus: no entry found");
      return null;
    }
    const cfg = await requireConfig();
    if (!cfg) {
      console.debug("getOdooStatus: not configured");
      return null;
    }
    entry = await enrichFull(cfg, entry);
    console.debug("getOdooStatus: returning " + JSON.stringify(entry));
    return entry;
  } catch (err) {
    console.debug("getOdooStatus: error", err);
    throw err;
  }
}

async function handleVerifyMessage(msg, sender) {
  const msgId = msg.messageId || (await getSenderTabMessageId(sender));
  if (!msgId) return null;
  const cfg = await requireConfig();
  if (!cfg) return { ok: false, error: "Not configured" };
  try {
    const result = await verifyMessageById(msgId);
    console.debug("verifyMessage: result=" + JSON.stringify(result));
    if (result) {
      await enrichFull(cfg, result);
      console.debug("verifyMessage: enriched=" + JSON.stringify(result));
      const url = getUrl(result);
      if (url) result.urlCopied = await copyToClipboard(url);
    }
    return result;
  } catch (err) {
    throw err;
  }
}

async function handleAddMessage(msg, sender) {
  const msgId = msg.messageId || (await getSenderTabMessageId(sender));
  if (!msgId) return null;
  const cfg = await requireConfig();
  if (!cfg) return { ok: false, error: "Not configured" };
  try {
    const mid = await importMessageById(msgId, msg.choice);
    if (!mid) return null;
    const entry = await getCachedResult(mid);
    if (!entry) return null;
    await enrichFull(cfg, entry);
    entry.success = entry.status === "found";
    const url = getUrl(entry);
    if (url && entry.success) entry.urlCopied = await copyToClipboard(url);
    return entry;
  } catch (err) {
    await showDialog("Odoo – Error", err.message);
    return errorResult(err);
  }
}

async function handleCountOdooMessages(msg) {
  const cfg = await requireConfig();
  if (!cfg) return { ok: false, error: "Not configured" };
  const maxAgeDays = msg.maxAgeDays ?? 365;
  const since = calcSinceDate(maxAgeDays);
  try {
    const count = await countMailMessages(cfg, since);
    return { ok: true, count };
  } catch (err) {
    return errorResult(err);
  }
}

/**
 * Reads the Helpdesk teams. `available` is false when Helpdesk is not
 * installed in Odoo. Uses msg.config when given ("Test connection" checks
 * the settings before they are saved), otherwise the stored settings.
 */
async function handleListHelpdeskTeams(msg) {
  const cfg = msg.config || (await requireConfig());
  if (!cfg) return { ok: false, error: "Not configured" };
  try {
    if (!(await isModelInstalled(cfg, "helpdesk.team")))
      return { ok: true, available: false, teams: [] };
    const teams = await listHelpdeskTeams(cfg);
    return { ok: true, available: true, teams };
  } catch (err) {
    return errorResult(err);
  }
}

browser.runtime.onMessage.addListener((msg, sender) => {
  try {
    switch (msg.action) {
      case "testConnection":
        return getConnectionInfo(msg.config).then((info) => ({
          ok: true,
          info,
        }));

      case "setup":
        return setup().then(() => ({ ok: true }));

      case "getOdooStatus":
        return handleGetOdooStatus(sender);

      case "verifyMessage":
        return handleVerifyMessage(msg, sender);

      case "addMessage":
        return handleAddMessage(msg, sender);

      case "countOdooMessages":
        return handleCountOdooMessages(msg);

      case "listHelpdeskTeams":
        return handleListHelpdeskTeams(msg);

      case "clearCache":
        return clearAllCache().then(() => ({ ok: true }));

      case "syncFromOdoo":
        return syncFromOdoo();

      case "getCacheInfo":
        return Promise.all([getCacheSize(), getLastSync()]).then(
          ([size, lastSync]) => ({ size, lastSync }),
        );
    }
  } catch (err) {
    return Promise.resolve(errorResult(err));
  }
});

async function registerDisplayScript() {
  const ns = browser.messageDisplayScripts || messenger.messageDisplayScripts;
  if (!ns) {
    console.debug(
      "registerDisplayScript: messageDisplayScripts API not available",
    );
    return;
  }
  try {
    await ns.register({
      js: [
        { file: "lib/importChoice.js" },
        { file: "lib/domUtils.js" },
        { file: "displayScript.js" },
      ],
    });
    console.debug("registerDisplayScript: registered");
  } catch (err) {
    console.debug("registerDisplayScript: failed", err);
  }
}

await setup();
await registerDisplayScript();
