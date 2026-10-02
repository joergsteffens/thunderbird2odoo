function renderMessage(text) {
  const el = document.getElementById("message");
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  for (const part of parts) {
    if (part.match(/^https?:\/\//)) {
      el.appendChild(makeLink(part));
    } else {
      el.appendChild(document.createTextNode(part));
    }
  }
}

// Optional <select> fields above the buttons; their values are sent back
// with the clicked button.
function renderSelects(selects) {
  const container = document.getElementById("selects");
  const els = {};
  for (const cfg of selects) {
    const label = document.createElement("label");
    label.textContent = cfg.label + ":";
    const select = document.createElement("select");
    select.id = "select-" + cfg.id;
    for (const o of cfg.options) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      select.appendChild(opt);
    }
    if (cfg.selected != null) select.value = cfg.selected;
    label.appendChild(select);
    container.appendChild(label);
    els[cfg.id] = select;
  }
  return els;
}

(async () => {
  const params = new URLSearchParams(location.search);
  document.title = params.get("title") || "Odoo Email Connector";
  renderMessage(params.get("message") || "");

  const win = await browser.windows.getCurrent();
  let buttons;
  try {
    buttons = JSON.parse(params.get("buttons"));
  } catch {
    buttons = [];
  }

  let selects;
  try {
    selects = JSON.parse(params.get("selects") || "[]");
  } catch {
    selects = [];
  }
  const selectEls = renderSelects(selects);

  const container = document.getElementById("buttons");
  for (const btn of buttons) {
    container.appendChild(
      createButton(
        btn.title,
        () => {
          const values = {};
          for (const [id, el] of Object.entries(selectEls))
            values[id] = el.value;
          browser.runtime.sendMessage({
            action: "dialogChoice",
            windowId: win.id,
            choice: btn.value,
            values,
          });
          window.close();
        },
        btn.tooltip,
      ),
    );
  }

  if (buttons.length === 0) {
    container.appendChild(createButton("OK", () => window.close()));
  }

  document.addEventListener("click", (e) => {
    const anchor = e.target.closest("a");
    if (anchor) {
      e.preventDefault();
      window.open(anchor.href, "_blank");
    }
  });
})();
