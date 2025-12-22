export function buildHeaders(cfg) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: "bearer " + cfg.apikey,
  };
  if (cfg.db) headers["X-Odoo-Database"] = cfg.db;
  return headers;
}

export async function odooCall(cfg, route, params) {
  const url = cfg.url + "/json/2/" + route;
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(cfg),
    body: JSON.stringify(params),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "Odoo error");

  return data.result;
}

export async function testOdooConnection(cfg) {
  return odooCall(cfg, "res.users/context_get", {});
}
