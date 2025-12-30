const urlInput = document.getElementById("url");
const dbInput = document.getElementById("db");
const apiKeyInput = document.getElementById("apikey");
const testBtn = document.getElementById("test");
const saveBtn = document.getElementById("save");
const status = document.getElementById("status");

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
  status.textContent = "Please test the connection";
}

(async () => {
  const stored = await browser.storage.local.get(["url", "db", "apikey"]);
  if (stored.url) urlInput.value = stored.url;
  if (stored.db) dbInput.value = stored.db;
  if (stored.apikey) apiKeyInput.value = stored.apikey;
  invalidate();
})();

[urlInput, dbInput, apiKeyInput].forEach((el) =>
  el.addEventListener("input", invalidate),
);

testBtn.addEventListener("click", async () => {
  const cfg = getConfig();

  if (!cfg.url || !cfg.apikey) {
    status.textContent = "URL and API key are required";
    return;
  }

  status.textContent = "Testing connection…";
  saveBtn.disabled = true;

  const result = await browser.runtime.sendMessage({
    action: "testConnection",
    config: cfg,
  });

  if (result.ok) {
    lastValidHash = hash(cfg);
    status.textContent = "Connection successful";
    saveBtn.disabled = false;
  } else {
    status.textContent = "Failed: " + result.error;
  }
});

document.getElementById("settings").addEventListener("submit", async (e) => {
  e.preventDefault();

  const cfg = getConfig();
  if (hash(cfg) !== lastValidHash) {
    status.textContent = "Please test before saving";
    return;
  }

  await browser.storage.local.set(cfg);

  const result = await browser.runtime.sendMessage({
    action: "setup",
  });

  status.textContent = "Settings saved";
});
