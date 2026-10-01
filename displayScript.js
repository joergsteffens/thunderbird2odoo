var _lastAction = null;
var _ignoreNextCacheChange = false;
var _pendingAction = false;
var _container = null;
var _cachedTeams = [];
var _cachedDefaultTeamId = null;

// Config shape expected by lib/importChoice.js, which is injected before this
// script and provides OdooImportChoice on the global scope.
function getImportChoiceConfig() {
  return {
    helpdeskTeams: _cachedTeams,
    helpdeskTeamId: _cachedDefaultTeamId,
  };
}

function refreshImportChoiceCache() {
  return messenger.storage.local
    .get(["helpdeskTeams", "helpdeskTeamId"])
    .then(function (stored) {
      _cachedTeams = Array.isArray(stored.helpdeskTeams)
        ? stored.helpdeskTeams
        : [];
      _cachedDefaultTeamId =
        stored.helpdeskTeamId !== undefined ? stored.helpdeskTeamId : null;
    })
    .catch(function (err) {
      console.debug("refreshImportChoiceCache failed:", err);
      _cachedTeams = [];
      _cachedDefaultTeamId = null;
    });
}

function getContainer() {
  if (!_container) {
    var mp = document.getElementById("messagepane");
    if (mp && mp.parentElement) {
      _container = mp.parentElement;
    } else {
      _container = document.body;
    }
  }
  return _container;
}

function normalizeUrl(base, ...parts) {
  var url = base.replace(/\/+$/, "");
  for (var i = 0; i < parts.length; i++) {
    url += "/" + String(parts[i]).replace(/^\/+|\/+$/g, "");
  }
  return url;
}

function renderBar(d, container) {
  var old = document.getElementById("odoo-status-bar");
  if (old) old.remove();

  if (!d || !d.status) return null;

  window._odooDebug = JSON.stringify(d);

  var b = document.createElement("div");
  b.id = "odoo-status-bar";
  b.style.cssText =
    "display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 12px;font:caption;border-bottom:1px solid ButtonBorder;background:-moz-dialog";

  var l = document.createElement("span");

  var btnRow = document.createElement("div");
  btnRow.style.cssText = "width:100%;display:flex;gap:6px;flex-wrap:wrap";

  function appendStatusElement(l, status) {
    var e = document.createElement("span");
    if (status === "found") {
      e.textContent = " \u25CF";
      e.style.color = "#1b8a1b";
    } else if (status === "parent_found") {
      e.textContent = " \u25CF";
      e.style.color = "#d49a00";
    } else if (status === "not_found") {
      e.textContent = " \u2715";
      e.style.color = "#c0392b";
    } else {
      return;
    }
    l.appendChild(e);
  }

  function badgeStyle(primary) {
    var base =
      "display:inline-flex;align-items:center;padding:1px 5px;border:1px solid ButtonBorder;border-radius:3px;text-decoration:none;cursor:pointer;background:ButtonFace;color:ButtonText";
    return primary
      ? base + ";font:caption"
      : base + ";font:small-caption;font-style:italic";
  }

  function appendUrls(l, baseUrl, modelSlug, messageSlug) {
    if (modelSlug) {
      var a = document.createElement("a");
      a.href = normalizeUrl(baseUrl, modelSlug);
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = modelSlug;
      a.title = a.href;
      a.style.cssText = badgeStyle(true);
      l.appendChild(a);
      l.appendChild(document.createTextNode(" "));
    }
    if (messageSlug && messageSlug !== modelSlug) {
      var b = document.createElement("a");
      b.href = normalizeUrl(baseUrl, messageSlug);
      b.target = "_blank";
      b.rel = "noreferrer";
      b.textContent = messageSlug;
      b.title = b.href;
      b.style.cssText = badgeStyle(false);
      l.appendChild(b);
    }
  }

  function renderStatusLine(l, status, label, baseUrl, modelSlug, messageSlug) {
    if (label) l.appendChild(document.createTextNode(label));
    appendUrls(l, baseUrl, modelSlug, messageSlug);
    appendStatusElement(l, status);
  }

  l.appendChild(document.createTextNode("Odoo: "));

  if (d.status === "found") {
    renderStatusLine(l, d.status, null, d.baseUrl, d.modelSlug, d.messageSlug);
  } else if (d.status === "parent_found") {
    renderStatusLine(
      l,
      d.status,
      "not found, only parent ",
      d.baseUrl,
      d.parentModelSlug,
      d.parentMessageSlug,
    );
  } else if (d.status === "not_found") {
    renderStatusLine(l, d.status, "not found", null, null, null);
  }

  if (_lastAction) {
    var a = document.createElement("span");
    a.textContent = " [" + _lastAction + "]";
    a.style.cssText = "font:status-bar;color:GrayText";
    l.appendChild(a);
  }

  var btnStyle =
    "padding:2px 10px;cursor:pointer;border:1px solid ButtonBorder;border-radius:3px;background:ButtonFace;color:ButtonText;white-space:nowrap;font:caption";
  btnRow.appendChild(
    createButton(
      "Verify",
      function () {
        doAction("verifyMessage");
      },
      null,
      btnStyle,
    ),
  );
  if (d.status === "parent_found") {
    btnRow.appendChild(
      createButton(
        "Add",
        function () {
          doAction("addMessage");
        },
        null,
        btnStyle,
      ),
    );
  } else if (d.status === "not_found") {
    // No predecessor either: one "Add as ..." button per import type, so the
    // destination is picked right here instead of in a popup dialog.
    // lib/importChoice.js supplies the types (Ticket only with Helpdesk) and,
    // with several teams, the team choices shown next to "Add as Ticket".
    var importChoiceCfg = getImportChoiceConfig();
    var teamChoices = OdooImportChoice.getTeamChoices(importChoiceCfg);
    var teamSelect = null;

    OdooImportChoice.getImportModelChoices(importChoiceCfg).forEach(
      function (c) {
        var isTicket = c.value === OdooImportChoice.MODEL_TICKET;
        btnRow.appendChild(
          createButton(
            "Add as " + c.label,
            function () {
              var choice = { model: c.value };
              if (isTicket && teamSelect && teamSelect.value) {
                choice.teamId = teamSelect.value;
              }
              doAction("addMessage", choice);
            },
            c.tooltip,
            btnStyle,
          ),
        );
        if (isTicket && teamChoices) {
          teamSelect = document.createElement("select");
          teamSelect.title = "Helpdesk team for the ticket";
          teamSelect.style.cssText =
            "font:caption;padding:2px 4px;border:1px solid ButtonBorder;border-radius:3px";
          teamChoices.options.forEach(function (o) {
            var opt = document.createElement("option");
            opt.value = o.value;
            opt.textContent = o.label;
            teamSelect.appendChild(opt);
          });
          teamSelect.value = teamChoices.selected;
          btnRow.appendChild(teamSelect);
        }
      },
    );
  }

  b.appendChild(l);
  b.appendChild(btnRow);
  container.insertBefore(b, container.firstChild);
  return b;
}

function doAction(action, choice) {
  if (_pendingAction) return;
  _pendingAction = true;
  var payload = { action: action };
  if (choice) payload.choice = choice;
  messenger.runtime
    .sendMessage(payload)
    .then(
      function (r) {
        _pendingAction = false;
        if (r && r.status) {
          if (action === "addMessage" && !r.success) {
            _lastAction = null;
          } else {
            _lastAction = action === "verifyMessage" ? "verified" : "added";
            if (r.urlCopied) _lastAction += ", URL copied";
          }
          _ignoreNextCacheChange = true;
          renderBar(r, getContainer());
          return;
        }
        refreshBar();
      },
      function (err) {
        console.error("doAction sendMessage rejected:", err);
        _pendingAction = false;
        refreshBar();
      },
    )
    .catch(function (err) {
      console.error("doAction failed:", err);
      _pendingAction = false;
    });
}

function refreshBar() {
  _lastAction = null;
  messenger.runtime
    .sendMessage({ action: "getOdooStatus" })
    .then(
      function (data) {
        if (!data || !data.status) return;
        renderBar(data, getContainer());
      },
      function (err) {
        console.debug("refreshBar error:", err);
      },
    )
    .catch(function (err) {
      console.error("refreshBar failed:", err);
    });
}

messenger.runtime.onMessage.addListener(function (msg) {
  if (msg.action === "refreshOdooStatus") {
    refreshBar();
  }
});

messenger.storage.onChanged.addListener(function (changes, area) {
  if (area === "local") {
    if (changes.odooMailCache) {
      if (_ignoreNextCacheChange) {
        _ignoreNextCacheChange = false;
        return;
      }
      refreshBar();
    }
    if (
      ["helpdeskTeams", "helpdeskTeamId"].some(function (k) {
        return k in changes;
      })
    ) {
      refreshImportChoiceCache().then(refreshBar);
    }
  }
});

refreshImportChoiceCache().then(refreshBar);
