// In-memory stand-ins for the Thunderbird WebExtension APIs and the Odoo
// JSON-2 API, so the background, display and options scripts can be run
// under node:test with a simulated configuration (e.g. a Helpdesk team list)
// instead of a real Thunderbird profile and Odoo database.

function makeEvent() {
  const listeners = [];
  return {
    listeners,
    addListener: (fn) => listeners.push(fn),
    removeListener: (fn) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    // Calls every listener and waits for the async ones.
    fire: (...args) => Promise.all(listeners.map((fn) => fn(...args))),
  };
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

/**
 * @param {Object} opts
 * @param {Object} [opts.storage] initial storage.local content
 * @param {string} [opts.rawMail] RFC822 source returned by messages.getRaw
 * @param {Function} [opts.onSendMessage] handler for runtime.sendMessage
 *   (used by the display and options scripts, which talk to the background)
 * @param {Function} [opts.answerDialog] simulates the user in dialog.html:
 *   gets the dialog ({title, message, buttons, selects}) and returns
 *   {choice, values} for a button click, or null to close the window
 */
export function createFakeBrowser({
  storage = {},
  rawMail = "",
  onSendMessage = async () => undefined,
  answerDialog = () => null,
} = {}) {
  const data = clone(storage);
  const onChanged = makeEvent();

  function notifyChanges(changes) {
    // Like Firefox, storage.onChanged fires asynchronously.
    if (Object.keys(changes).length)
      setTimeout(() => onChanged.fire(changes, "local"), 0);
  }

  const menus = new Map();
  const sentMessages = [];
  const dialogs = [];
  const notifications = [];
  const windowsOnRemoved = makeEvent();
  let nextWindowId = 1;

  const fake = {
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return clone(data);
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of list) if (k in data) out[k] = clone(data[k]);
          return out;
        },
        async set(items) {
          const changes = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: clone(data[k]), newValue: clone(v) };
            data[k] = clone(v);
          }
          notifyChanges(changes);
        },
        async remove(keys) {
          const changes = {};
          for (const k of Array.isArray(keys) ? keys : [keys]) {
            if (k in data) {
              changes[k] = { oldValue: clone(data[k]) };
              delete data[k];
            }
          }
          notifyChanges(changes);
        },
      },
      onChanged,
    },
    menus: {
      create(spec) {
        menus.set(spec.id, { ...spec });
        return spec.id;
      },
      async update(id, props) {
        if (!menus.has(id)) throw new Error("Could not find menu item " + id);
        Object.assign(menus.get(id), props);
      },
      removeAll() {
        menus.clear();
        return Promise.resolve();
      },
      refresh: async () => {},
      onShown: makeEvent(),
      onClicked: makeEvent(),
    },
    permissions: {
      contains: async () => true,
      request: async () => true,
    },
    runtime: {
      onMessage: makeEvent(),
      getURL: (path) => "moz-extension://test/" + path,
      async sendMessage(msg) {
        // Messages are serialized between extension pages, as in Firefox.
        sentMessages.push(clone(msg));
        return clone(await onSendMessage(clone(msg)));
      },
    },
    windows: {
      async create(opts) {
        const id = nextWindowId++;
        const params = new URLSearchParams(opts.url.split("?")[1] || "");
        const dialog = {
          title: params.get("title"),
          message: params.get("message"),
          buttons: JSON.parse(params.get("buttons") || "[]"),
          selects: JSON.parse(params.get("selects") || "[]"),
        };
        dialogs.push(dialog);
        const answer = answerDialog(dialog);
        setTimeout(() => {
          if (answer)
            fake.runtime.onMessage.fire({
              action: "dialogChoice",
              windowId: id,
              ...answer,
            });
          else windowsOnRemoved.fire(id);
        }, 0);
        return { id };
      },
      onRemoved: windowsOnRemoved,
    },
    notifications: {
      async create(id, opts) {
        notifications.push(opts);
      },
    },
    messages: {
      getRaw: async () => rawMail,
      get: async (id) => ({ id, headerMessageId: "" }),
      getFull: async () => ({ headers: {} }),
    },
    messageDisplayScripts: { register: async () => {} },
  };

  return {
    browser: fake,
    storage: data,
    menus,
    sentMessages,
    dialogs,
    notifications,
  };
}

/**
 * Replaces globalThis.fetch with a fake Odoo JSON-2 endpoint.
 *
 * @param {Object<string, Function>} routes handlers by route, e.g.
 *   "mail.thread/message_process": (body) => 42; a handler that throws
 *   makes Odoo answer with an error, an unknown route with HTTP 404
 * @returns {Array<{route:string, body:Object}>} recorded requests
 */
export function installFakeOdoo(routes = {}) {
  const requests = [];
  const defaults = {
    "res.users/context_get": () => ({ uid: 2 }),
    "mail.message/search_read": () => [],
    "mail.message.subtype/search_read": () => [{ id: 1 }],
  };
  globalThis.fetch = async (url, opts) => {
    const route = String(url).split("/json/2/")[1];
    const body = JSON.parse(opts.body);
    requests.push({ route, body });
    const handler = routes[route] || defaults[route];
    if (!handler) {
      return {
        ok: false,
        status: 404,
        text: async () =>
          JSON.stringify({ message: "No route " + route + " in fake Odoo" }),
      };
    }
    let result;
    try {
      result = handler(body);
    } catch (err) {
      // A throwing handler simulates an Odoo error response.
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ message: err.message }),
      };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(result) };
  };
  return requests;
}

/** Waits until pending timers and promise callbacks have run. */
export async function settle(rounds = 5) {
  for (let i = 0; i < rounds; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
}
