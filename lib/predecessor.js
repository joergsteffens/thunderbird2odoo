/**
 * Looks up the predecessors (In-Reply-To / References) of an email in Odoo.
 *
 * Always asks Odoo instead of trusting cached "found" entries: the parent
 * record may have been deleted since it was cached. Stale "found" entries
 * are marked as not found.
 *
 * @param {Object} cfg Odoo config
 * @param {string[]} pids predecessor Message-Ids, closest first
 * @param {Object} deps { findMails, getCachedResult, cacheFoundResult,
 *   cacheNotFoundResult } — injected so the logic can be unit tested
 * @returns {Promise<{messageId:string, entry:Object}|null>} closest
 *   predecessor found in Odoo
 */
export async function findPredecessor(cfg, pids, deps) {
  if (!pids || pids.length === 0) return null;
  const found = await deps.findMails(cfg, pids);
  let result = null;
  for (const pid of pids) {
    const r = found[pid];
    if (r) {
      const entry = await deps.cacheFoundResult(
        pid,
        r.model,
        r.resId,
        r.odooMessageId,
      );
      if (!result) result = { messageId: pid, entry };
    } else if ((await deps.getCachedResult(pid))?.status === "found") {
      await deps.cacheNotFoundResult(pid);
    }
  }
  return result;
}
