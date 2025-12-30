/********************************************************************
 * Odoo Mail Import – Thunderbird MailExtension
 * Odoo >= 19
 ********************************************************************/

import { testOdooConnection } from "./lib/odooClient.js";
import { uploadMail } from "./lib/odooMailUpload.js";

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
  const cfg = await browser.storage.local.get(["url", "db", "apikey"]);
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
  // create a context menu
  browser.menus.create({
    id: "send-to-odoo",
    title: "Import Email into Odoo",
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

// handle menu click
browser.menus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "send-to-odoo") return;

  const message = info.selectedMessages?.messages?.[0];
  if (!message) {
    throw new Error("Select exactly one email");
  }

  try {
    // get raw email
    const rawMail = await messenger.messages.getRaw(message.id);

    // load Odoo config from options
    const cfg = await get_config();

    const import_result = await uploadMail(cfg, rawMail);

    notify(
      "Odoo",
      "Email successfully transferred to Odoo (" + import_result + ")",
    );
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
