import { odooCall } from "./odooClient.js";

/**
 * Upload raw RFC822 email to Odoo
 * @param {Object} cfg Odoo config
 * @param {string} rawMail RFC822 content including headers and attachments
 * @param {Object} context Optional Odoo context
 */
export async function uploadMail(cfg, rawMail) {
  return odooCall(cfg, "mail.thread/message_process", {
    model: false,
    message: rawMail,
  });
}
