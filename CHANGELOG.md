# Changelog

## Unreleased

### Features

- **Import as Helpdesk Ticket**: emails can be imported as `helpdesk.ticket`. When Helpdesk is available, the "How do you want to import it?" dialog also offers *As Ticket (Helpdesk)*, with a team select when there are several teams. Without Helpdesk, the dialog is unchanged (Opportunity or Generic).
- **Status bar**: for an email without Odoo record and predecessor, *Add* is replaced by one button per import type (*Add as Ticket (Helpdesk)*, *Add as Opportunity (CRM Lead)*, *Add as Generic*, Ticket only with Helpdesk), so the email is imported with one click. With several Helpdesk teams, a team select follows *Add as Ticket*. The status bar no longer preselects an import type, so the *Default Import Type* option is gone.
- **Import Settings** in the options: default Helpdesk team (not set by default: Odoo picks the team), *Load teams from Odoo*. *Test connection* and *Load teams from Odoo* check whether Helpdesk is installed; without it, the Helpdesk options are shown greyed out. After upgrading, click *Load teams from Odoo* once to enable the Ticket import.

### Fixes

- **Stale cache on Verify**: predecessors are always re-checked in Odoo, so replies are no longer linked to a deleted record.
- **Wrong follower on imported tickets** (opt-in, *Import Settings*): Odoo reads recipients from the `Delivered-To` header first, which after local delivery can hold the internal mailbox (e.g. `user@internal-domain`) and adds it as a follower. When enabled, `Delivered-To` is replaced with `X-Original-To` before upload (or removed when missing, so Odoo falls back to `To`).

## 0.6.3

### Fixes

- **Import errors not shown**: errors during email import (e.g. Odoo AccessError) were silently swallowed when importing via the status bar "Add" button. Errors are now shown in a dialog so the full message is visible.
- **Error message extraction**: `parseResponse` now correctly extracts human-readable error messages from Odoo HTTP error responses that return the error object at the top level (not nested under `error`).
- **Verify errors not shown**: errors during the verify action were silently swallowed. The error now propagates and the status bar refreshes.
- **Status bar error handling**: `handleGetOdooStatus` now throws errors instead of silently returning an error result that the display script ignored.
- **Post-upload lookup errors**: removed silent error swallowing in post-upload email lookup; errors are now logged properly.
- **Display script error logging**: silent `.catch(function () {})` handlers now log errors to the console.

## 0.6.2

### Changes

- **Options page redesigned**: added logo, tagline, usage summary, and data-privacy notice in a sidebar layout.
- **Config caching**: config is now cached in memory after first read and invalidated on `storage.onChanged`, avoiding repeated `storage.local` IPC calls.
- **Manifest description**: updated to better describe the add-on.

### Fixes

- **Verify not updating cache**: fixed a bug where the verify action did not always refresh the local cache entry for the verified message.

## 0.6.1

### Changes

- **Refactored URL handling**: replaced modelUrl/messageUrl with baseUrl+slug pattern, renamed combineUrl→normalizeUrl, added normalizeUrl unit tests.
- **Status bar styling**: badges now use system colors (ButtonFace/ButtonBorder/ButtonText) and system fonts (caption/small-caption/status-bar) for dark mode compatibility.
- **Removed dead code**: makeIconLink and buildOdooUrl removed.
- **CI consolidated**: single CI workflow runs lint, builds XPI, and creates a release on v* tag push (via softprops/action-gh-release).
- **Fixed parentMessageSlug fallback**: getUrl now considers parentMessageSlug.
- **Fixed numeric ID handling**: normalizeUrl coerces parts to String() for numeric Odoo IDs.

### Fixes

- **AMO review: sync message listener**: `runtime.onMessage` listener is no longer `async` to avoid interfering with other listeners (async listeners always return a Promise, which Thunderbird warns about).
- **Message sync domain filter**: `buildMailDomain` now uses a complex domain that excludes internal messages and non-Discussion notifications (`message_id != false AND is_internal = false AND (message_type != "notification" OR subtype_id = Discussions)`).
- **Discussion subtype lookup**: subtype ID is now fetched from Odoo via `mail.message.subtype/search_read` instead of being hardcoded to `1`, with session-level caching.
- **Mail search**: `findMails` searches only bracketed `[<id>]` format (not `[id, <id>]`), matching Odoo's stored format.

## 0.6.0

### Features

- **Email status bar**: a colored status bar now appears in the message reader when viewing an email that has been checked against Odoo (via the right-click menu). Shows whether the email (or its predecessor) was found in Odoo, with buttons to open, verify, or add the email. Status is cached per email and persists across restarts.
- **Sync from Odoo**: bulk-fetches message IDs from Odoo (within a configurable max-age window) into the local cache. Supports incremental sync (since last sync) and a configurable limit.
- **Verify multiple messages**: select multiple emails and verify them in batch; the menu label reflects the count (e.g. _Verify 3 messages_).
- **Count button**: preview how many messages Odoo will return for the current max-age setting before syncing.
- **Clear Odoo Cache**: button in the options page to invalidate all cached statuses.
- **Options sync section**: max age, sync limit, cache entry count, last sync time (auto-refreshes via `storage.onChanged`).

### Changes

- **Renamed to Odoo Email Connector**: the add-on name now better reflects its broader scope — import, verify, sync, and inline status display.
- **Internal**: refactored `handleOdooImporter` into reusable `importMessageById` and `verifyMessageById` functions.
- **Clipboard copy**: moved entirely to background script (display scripts cannot access `navigator.clipboard`; requires `clipboardWrite` permission).
- **`search_count` endpoint**: used for estimated message counts before sync.
- **Odoo datetime handling**: ISO strings stripped of trailing `Z` to avoid Odoo parse errors.
- **`setup()` menu fix**: `menuIds` set is never cleared (was cleared on every `setup()` call without being repopulated, breaking the `onShown` listener).
- **parent cache lookup**: display script falls back to predecessor cache entries when the current message is not cached, reducing noise for new messages in known threads.

## 0.5.1

### Fixes

- **AMO review warnings**: replaced `innerHTML` assignments with safe DOM APIs (`createTextNode`/`createElement`) in `dialog.js` and `options.js`, resolving two "Unsafe assignment to innerHTML" warnings from the Thunderbird add-on validator

## 0.5.0

### Fixes

- **UTF-8 decoding**: raw emails from `getRaw()` are now properly decoded as UTF-8 before uploading to Odoo, fixing scrambled non-ASCII characters (e.g. `Ã¼` instead of `ü`) (#2)

### Changes

- The plugin is now able for query Odoo about emails, show information and propose matching actions.
- **Optional host permissions**: replaced the broad `<all_urls>` install-time permission with `optional_permissions` (`*://*/*`); the user is now explicitly prompted for consent when clicking _Test connection_ in the options page (per AMO review)

### Features

- **Connection test info**: a successful _Test connection_ now shows the authenticated user's login (in monospace) with display name in braces, e.g. `Connection successful as admin (Mitchell Admin)`

## 0.3.0

- Initial release
