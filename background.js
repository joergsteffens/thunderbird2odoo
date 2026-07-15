/********************************************************************
 * Odoo Email Connector – Thunderbird MailExtension
 * Odoo >= 19
 ********************************************************************/

import {
  testOdooConnection,
  getConnectionInfo,
  findMail,
  findMails,
  buildOdooUrl,
  searchMailMessages,
  countMailMessages,
  unifyMessageId,
} from "./lib/odooClient.js";
import { uploadMail, decodeRawMail } from "./lib/odooMailUpload.js";
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
  if (entry.odooMessageId)
    entry.messageUrl = buildOdooUrl(cfg, "mail.message", entry.odooMessageId);
  if (entry.model && entry.resId)
    entry.modelUrl = buildOdooUrl(cfg, entry.model, entry.resId);
  return entry;
}

async function enrichWithParentUrl(cfg, entry) {
  if (!entry || !entry.parentMessageId) return entry;
  const parentEntry = await getCachedResult(entry.parentMessageId);
  if (parentEntry) {
    entry.parentModelUrl = buildOdooUrl(
      cfg,
      parentEntry.model,
      parentEntry.resId,
    );
    entry.parentMessageUrl = buildOdooUrl(
      cfg,
      "mail.message",
      parentEntry.odooMessageId,
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
  return (
    entry.modelUrl ||
    entry.messageUrl ||
    entry.parentModelUrl ||
    entry.parentMessageUrl
  );
}

async function findPredecessor(cfg, pids) {
  for (const pid of pids) {
    const cached = await getCachedResult(pid);
    if (cached?.status === "found") {
      return { messageId: pid, entry: cached };
    }
    const found = await findAndCache(cfg, pid);
    if (found.status === "found") {
      return { messageId: pid, entry: found };
    }
  }
  return null;
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

  if (r.modelUrl) message += "\n" + r.modelUrl;
  if (r.messageUrl && r.messageUrl !== r.modelUrl)
    message += "\n" + r.messageUrl;

  return { title, message };
}

async function showResult(prefix, r, cfg, sticky = false) {
  enrichEntry(cfg, r);
  const n = buildNotification(prefix, r);
  let message = n.message;
  const url = r.modelUrl || r.messageUrl;
  if (url) {
    const copied = await copyToClipboard(url);
    if (copied) {
      message += "\nURL copied to clipboard";
    }
  }
  notify(n.title, message, sticky);
}

async function get_config() {
  return browser.storage.local.get(["url", "db", "apikey"]);
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

async function debugTry(prefix, fn) {
  try {
    return await fn();
  } catch (err) {
    console.debug(prefix + ": " + err.message);
    return null;
  }
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
  const params = new URLSearchParams({
    title,
    message,
    buttons: JSON.stringify(buttons),
  });
  const url = browser.runtime.getURL("dialog.html?" + params);
  const win = await browser.windows.create({
    url: url,
    type: "popup",
    width: 600,
    height: 360,
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
        resolve(msg.choice);
      }
    };
    const closeListener = (windowId) => {
      if (windowId === win.id) {
        cleanup();
        resolve(-1);
      }
    };
    browser.runtime.onMessage.addListener(msgListener);
    browser.windows.onRemoved.addListener(closeListener);
  });
}

async function importMessageById(tbMessageId) {
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

  // Step 3: No predecessor found
  await cacheNotFoundResult(mid);
  const btnIdx = await showDialog(
    "Odoo Email Connector",
    "This email and its predecessor are not in Odoo. How do you want to import it?",
    [
      { title: "As Opportunity (CRM Lead)", value: 0 },
      {
        title: "Generic",
        value: 1,
        tooltip:
          "Might fail on Odoo 19 without Lost Messages module, see https://github.com/joergsteffens/thunderbird2odoo",
      },
    ],
  );
  if (btnIdx === 0) {
    await uploadAndShowResult(
      cfg,
      "crm.lead",
      "Email imported as Opportunity (CRM Lead)",
      decoded,
      mid,
    );
  } else if (btnIdx === 1) {
    await uploadAndShowResult(cfg, false, "Email imported", decoded, mid);
  }
  return mid;
}

async function verifyMessageById(tbMessageId) {
  const cfg = await get_config();
  const msg = await messenger.messages.get(tbMessageId);
  const mid = unifyMessageId(msg.headerMessageId);
  if (!mid) return null;

  const cached = await getCachedResult(mid);
  console.debug(
    "verifyMessageById: mid=" + mid + " cached=" + JSON.stringify(cached),
  );
  if (cached?.status === "found" || cached?.status === "parent_found") {
    return cached;
  }

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

async function uploadAndShowResult(cfg, model, prefix, decoded, messageId) {
  const rawResult = await uploadMail(cfg, decoded, model);
  console.debug("uploadAndShowResult: rawResult=" + JSON.stringify(rawResult));

  if (rawResult) {
    // message_process returned a thread_id — email was routed successfully.
    let found = null;
    if (messageId) {
      found = await debugTry("uploadAndShowResult: findMail failed", () =>
        findAndCache(cfg, messageId),
      );
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
      const found = await debugTry("uploadAndShowResult: findMail failed", () =>
        findAndCache(cfg, messageId),
      );
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
    notify("Odoo " + EN_DASH + " Error", err.message);
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
  const msgId = await getSenderTabMessageId(sender);
  if (!msgId) {
    console.debug("getOdooStatus: no msgId");
    return null;
  }
  const m = await messenger.messages.get(msgId);
  const mid = unifyMessageId(m.headerMessageId);
  if (!mid) {
    console.debug("getOdooStatus: no mid");
    return null;
  }
  const cfg = await requireConfig();
  if (!cfg) {
    console.debug("getOdooStatus: not configured");
    return null;
  }
  let entry = await getCachedResult(mid);
  console.debug(
    "getOdooStatus: mid=" + mid + " cached=" + JSON.stringify(entry),
  );
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
    if (!entry) {
      console.debug("getOdooStatus: no entry found");
      return null;
    }
  }
  entry = await enrichFull(cfg, entry);
  console.debug("getOdooStatus: returning entry=" + JSON.stringify(entry));
  return entry;
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
    return errorResult(err);
  }
}

async function handleAddMessage(msg, sender) {
  const msgId = msg.messageId || (await getSenderTabMessageId(sender));
  if (!msgId) return null;
  const cfg = await requireConfig();
  if (!cfg) return { ok: false, error: "Not configured" };
  const mid = await importMessageById(msgId);
  if (!mid) return null;
  const entry = await getCachedResult(mid);
  if (!entry) return null;
  await enrichFull(cfg, entry);
  entry.success = entry.status === "found";
  const url = getUrl(entry);
  if (url && entry.success) entry.urlCopied = await copyToClipboard(url);
  return entry;
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

browser.runtime.onMessage.addListener(async (msg, sender) => {
  try {
    if (msg.action === "testConnection") {
      const info = await getConnectionInfo(msg.config);
      return { ok: true, info };
    }

    if (msg.action === "setup") {
      await setup();
      return { ok: true };
    }

    if (msg.action === "getOdooStatus") {
      return await handleGetOdooStatus(sender);
    }

    if (msg.action === "verifyMessage") {
      return await handleVerifyMessage(msg, sender);
    }

    if (msg.action === "addMessage") {
      return await handleAddMessage(msg, sender);
    }

    if (msg.action === "countOdooMessages") {
      return await handleCountOdooMessages(msg);
    }

    if (msg.action === "clearCache") {
      await clearAllCache();
      return { ok: true };
    }

    if (msg.action === "syncFromOdoo") {
      return await syncFromOdoo();
    }

    if (msg.action === "getCacheInfo") {
      const size = await getCacheSize();
      const lastSync = await getLastSync();
      return { size, lastSync };
    }
  } catch (err) {
    return errorResult(err);
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
      js: [{ file: "lib/domUtils.js" }, { file: "displayScript.js" }],
    });
    console.debug("registerDisplayScript: registered");
  } catch (err) {
    console.debug("registerDisplayScript: failed", err);
  }
}

await setup();
await registerDisplayScript();
