# Stage 1: Windows multi-account foundation

Stage 1 backend acceptance is now complete for the two tested accounts. Stage 2 scheduling/storage has also been implemented; see [Stage 2 notes](multi-account-stage2.md) for the current cache/manual-refresh API and development controls. The historical verification record below describes Stage 1, not a packaged/full-fleet release.

Stage 1 adds a host-side account API, independent encrypted saved sign-ins, complete service-list pagination, and explicitly targeted read requests. The intended deployment uses separate Starlink email logins. The full account-list and dish-selection screens belong to Stage 3; production UI still uses its original single-account flow. Windows development runs now open a read-only account test panel for the user-authorized live verification.

## Connection and storage

Each new sign-in gets an opaque UUID and an Electron browser partition named `persist:starlink-login-<credentialId>`. A native Starlink window or an imported active session can supply that login. Imports are validated before replacing a saved session. A failed replacement leaves the previous saved session usable. An explicit native reconnect clears only that credential's browser cookies before sign-in, so a previous browser session cannot silently replace a newer cookie import. Cancelling reconnect retains the previously saved credential.

Records are versioned and encrypted through Electron `safeStorage`, under the user's application-data directory in `accounts-v1`. Each credential has one atomically replaced encrypted file containing its session and cached inventory. There is no plaintext fallback. An unreadable record remains visible as reconnect-required; its original file is left intact. Stored cookies are never returned through the renderer API.

Disconnecting a login clears its saved secret and that login's browser storage while keeping its cached inventory. Stop tracking is independent of authentication. Stage 2 now adds remote snapshot history and scheduled refresh; neither disconnect nor stop tracking implicitly deletes it. History-removal presentation remains later UI work. Existing local history and the legacy single-account session are not migrated or retargeted by Stage 1.

## Desktop API

Windows exposes the optional `window.dishlink.accountRequest(request)` preload method. It uses an allowlisted main-process channel; requests from another window, a subframe, or another origin are rejected. Other platforms retain their existing interface.

| Request                                              | Behavior                                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `{ kind: "list" }`                                   | Returns public session summaries, cached inventories, and deduplicated accounts with their credential access paths |
| `{ kind: "sign-in", label: "Account A" }`            | Opens an isolated native sign-in and returns its opaque credential ID after validation                             |
| `{ kind: "sign-in", credentialId }`                  | Reconnects only the named saved sign-in                                                                            |
| `{ kind: "import", label, cookie, credentialId? }`   | Validates and saves a supplied active session; omit ID for a new login                                             |
| `{ kind: "refresh", credentialId }`                  | Refreshes that login's cached inventory on demand                                                                  |
| `{ kind: "tracking", credentialId, enabled: false }` | Stops tracking while retaining the signed-in session                                                               |
| `{ kind: "disconnect", credentialId }`               | Disconnects only that login and clears its native browser cookies                                                  |
| `{ kind: "read", credentialId, route, context }`     | Performs an explicitly scoped read                                                                                 |

A read context contains `credentialId`, `accountId`, `serviceLineNumber`, and `terminalId`. All must match the named login's cached inventory before a network request is made. Read routes are limited to `/cloud/account`, `/cloud/telemetry`, and `/cloud/usage`. Telemetry output is filtered to the selected terminal and its known routers; usage requests name the selected service rather than the first service returned by the portal.

Every operation returns `{ status, body }`. Notable statuses include 400 (unsupported/malformed operation), 403 (mismatched target), 404 (unknown session), 409 (session changed during work), 428 (sign-in required), 499 (native sign-in cancelled), and 5xx (storage/upstream failure). Error bodies are deliberately generic and never copy an upstream exception containing credentials.

The new API cannot issue configuration changes or pause devices. Existing single-account write routes retain their original handler and cannot be retargeted by a multi-account selection. Binding existing local controls and rules to verified multi-account identities remains Stage 4 work.

## Inventory limitations requiring live verification

The adapter uses the service-list/detail and auth endpoints already present in this repository. It walks service-list pages, reads details with at most two concurrent requests, retains multiple/replacement terminals, and discovers account references returned by the list plus an account ID reported by the auth identity. Invalid/mismatched responses fail rather than silently becoming an empty account.

No unobserved account-switch endpoint has been invented. If a login can access additional accounts that the existing service-list endpoint does not return, that requires a verified portal response before support can be claimed. In particular, additional accounts without services cannot be inferred from a list containing no reference to them. Separate email logins are the primary user scenario.

On 2026-10-27 the user confirmed that both separate native sign-ins work and retrieve telemetry remotely. Follow-up Stage 0 checks relaunched the app, loaded both saved connections, successfully read a dish and refreshed inventory under each without reconnecting. Raw response schemas were also inspected for capability coverage. Live multi-page pagination, full expected inventory reconciliation and cookie renewal longevity remain unverified. See the [remote capability matrix](remote-telemetry-capabilities.md) for field semantics and evidence limits. Do not submit cookies through chat, paste them into issue reports, or commit real response fixtures.

## Development verification

Run the regular typecheck, lint, and full test suite. New tests cover account ownership, more than 100 services, bounded detail retrieval, separate saved sessions/restarts, failed replacement, encrypted persistence, disconnect cancellation, login-window cleanup, and read-route/sender validation.

For manual verification, run `npm run dev:electron:win` in this worktree. The Windows development app opens **Read-only account test** instead of the local dashboard. Click **Sign in Account A**, complete Starlink's own sign-in window, then repeat with **Sign in Account B**. Saved connections display their discovered service/dish inventory. **Read telemetry** sends a read for that specific dish; **Refresh inventory** refreshes only that sign-in. **Reload saved connections** reads the local saved-session index without an upstream request.

The panel exposes no device mutations, cookie import, or disconnect/deletion actions. Its original operations are `list`, `sign-in`, `refresh`, and `read`; Stage 2 adds `remote-cache` and `remote-refresh` controls. Packaged multi-account reads must use the scheduler/cache API; raw live `read`/inventory `refresh` remain unpackaged diagnostics. Repeating a labelled sign-in reconnects its existing credential rather than silently creating another. Production builds exclude the panel; normal browser and extension entry points are unchanged. Its English diagnostic labels are development-only.

Users enter credentials directly in Starlink's native login windows. Both native sign-ins and remote reads are user-confirmed. A subsequent live relaunch loaded both saved connections and successfully read a dish from each without reconnecting. Additional disconnect/lifecycle checks remain covered by the API tests pending the full management UI.

## Verification record — 2026-10-27

| Check                                         | Result                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Full `npm test`                               | 136 test files, 1,398 tests passed, including 61 new tests                                  |
| `npm run typecheck`                           | Passed                                                                                      |
| `npm run lint`                                | Passed                                                                                      |
| `npm run typecheck:extension`                 | Passed                                                                                      |
| `npm run build:extension`                     | Passed                                                                                      |
| `npm exec -- cross-env ELECTRON=1 vite build` | Desktop/renderer bundles passed; existing `platform`/`codeSplitting` option warnings remain |
| Independent review                            | Four Important findings reproduced and corrected with regression tests; no Critical finding |

Checks used the installed dependency tree shared from the original checkout through a worktree junction. No manifest/lockfile changes, new dependency installation, or fresh `npm ci` against the branch's lockfile were performed. A clean-install CI run and packaged Windows acceptance remain separate verification. Real native sign-in and off-LAN reads are user-confirmed independently of the mocked tests; saved-session reads after relaunch are now also verified. Natural expiry and broader portal semantics remain pending. The Stage 0 diagnostic follow-up passed 137 test files / 1,403 tests, typecheck and lint; it adds five audit privacy/response-preservation tests without implementing the planned telemetry features.
