/********************************************************************
 * Odoo Mail Importer – Thunderbird MailExtension
 * Odoo >= 19
 ********************************************************************/

import { testOdooConnection } from "./lib/odooClient.js";
import { uploadMail } from "./lib/odooMailUpload.js";

const MENU_ID_PREFIX = "send-to-odoo";

function notify(title, message) {
  console.log(title + ": " + message);
  browser.notifications.create("thunderbird2odooNotifyId", {
    type: "basic",
    //"thunderbird2odoo.svg",
    iconUrl: browser.runtime.getURL("icons/odoo-48.png"),
    title: title,
    message: message,
  });
}

async function get_config() {
  // load Odoo config from options
  const cfg = await browser.storage.local.get([
    "url",
    "db",
    "apikey",
    "models",
  ]);
  return cfg;
}

async function setup() {
  browser.menus.removeAll();
  const cfg = await get_config();
  try {
    await testOdooConnection(cfg);
  } catch (err) {
    console.log("setup error: " + err);
    return;
  }

  for (const item of cfg.models) {
    let model = false;
    let id = MENU_ID_PREFIX;
    let title = "Import Email into Odoo";
    if (item !== "false") {
      model = item;
      id = MENU_ID_PREFIX + "-" + model;
      title = "Import Email into Odoo as " + model;
    }
    // create a context menu
    browser.menus.create({
      id: id,
      title: title,
      contexts: ["message_list"],
      icons: {
        16: "icons/odoo-16.png",
        32: "icons/odoo-32.png",
        48: "icons/odoo-48.png",
        96: "icons/odoo-96.png",
        128: "icons/odoo-128.png",
      },
    });
  }
}

// handle menu click
browser.menus.onClicked.addListener(async (info) => {
  if (!info.menuItemId.startsWith(MENU_ID_PREFIX)) return;

  // extract string after: prefix + "-"
  let model = info.menuItemId.slice(MENU_ID_PREFIX.length + 1);
  if (!model) {
    model = false;
  }

  const message = info.selectedMessages?.messages?.[0];
  if (!message) {
    throw new Error("Select exactly one email");
  }

  try {
    // get raw email
    const rawMail = await messenger.messages.getRaw(message.id);

    // load Odoo config from options
    const cfg = await get_config();

    const import_result = await uploadMail(cfg, rawMail, model);

    if (!model) {
      notify("Odoo", "Email successfully transferred to Odoo");
    } else if (import_result) {
      notify(
        "Odoo",
        "Email successfully transferred to Odoo as " +
          model +
          " " +
          import_result,
      );
    } else {
      notify(
        "Odoo",
        "Failed to import Email as " + model + ". Maybe it is already present?",
      );
    }
  } catch (err) {
    notify("Odoo – Error", "Failed to send email: " + err.message);
  }
});

// handle runtime messages from options.js
browser.runtime.onMessage.addListener(async (msg) => {
  try {
    if (msg.action === "testConnection") {
      await testOdooConnection(msg.config);
      return { ok: true };
    }

    if (msg.action === "setup") {
      await setup();
      return { ok: true };
    }

    if (msg.action === "uploadMail") {
      await uploadMail(msg.config, msg.rawMail);
      return { ok: true };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

await setup();
