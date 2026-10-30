# Stage 2: Scheduled Windows remote snapshots

**Stage 3 follow-up — 2026-10-30:** Windows now uses the production Accounts → Services → Service information screens in development and packaged builds. The development test panel is no longer the startup UI. See [Stage 3 implementation notes](multi-account-stage3.md) for the current controls, scope and verification. Earlier statements below describe the stage at the time it was implemented.

Stage 1's remaining sign-in/inventory acceptance items are satisfied for the two tested accounts: independent native logins, complete expected inventory, remote readings matching the portal/app and saved-session reads after relaunch. Stage 2 builds on that foundation in the same isolated worktree. The production Accounts → Services → Service information screens remain Stage 3.

## Collection and data contract

Windows starts the remote monitor in Electron main, independently of the renderer and LAN recorder. Every tracked account defaults to a two-hour interval; account settings accept 2, 4, 6, 12 or 24 hours. Accounts exposed by multiple logins are collected once, with a preferred credential retained in account settings. One due job refreshes inventory, then fetches an account-wide telemetry payload and distributes rows among the verified services/terminals. Multiple accounts on one login share a recent inventory refresh. No usage/billing collection, new router poll, device command or interpreted remote alert is added.

There are at most two refresh jobs globally and one per credential. Startup, reconnect and overdue resume work receive up to 30 seconds of jitter. Persisted future due times survive relaunch. Resume/network recovery triggers at most one catch-up per due account, not a replay of every missed interval. Closing the window leaves monitoring in the tray; quitting the app, sleeping or switching off the computer prevents background collection. The lifecycle pump checks OS network state and the scheduler every five seconds; that is a local timer, not a five-second cloud or router poll.

Manual refresh joins queued/in-flight account work or enforces a five-minute manual cooldown. Account and credential-scoped upstream backoff takes precedence. Retry-After is preserved for 429 and upstream failures supplying it; shared inventory/auth deadlines block every account on that login and survive restart. Transient failures use jittered exponential delay, with at most three attempts in a failed cycle before returning to the regular interval. An expired login pauses its jobs until reconnection; other logins continue. No-op tracking/settings updates do not reset cadence; stop/start tracking and preferred-credential changes preserve due times and retry budget. Interval changes schedule from the last attempt, keeping a failed cycle from being retriggered by settings resubmission. Credential replacement, stopped tracking and changed service membership invalidate late results.

`core/remoteTelemetry.ts` validates known device legends and row completeness before status classification. It resolves fields by legend name, preserves valid numeric zero and raw obstruction fractions, rejects non-finite/coerced numeric values, and keeps missing timestamps/booleans unknown. `UtcTimestampNs` is converted to milliseconds; software/hardware strings and optional router metrics remain separate from identity. Location fields and ActiveAlerts are not normalized into scheduled snapshots. The earlier raw alert-code development diagnostic remains available, with production interpretation deferred to L8.

For a valid complete response, selected dish information means last-reported online; a genuinely empty selected-dish result means offline under the user's confirmed contract. Router-only or incomplete/malformed data does not establish offline. Transport/auth/schema failure retains the last successful cache and exposes a refresh error rather than manufacturing a new offline event. Snapshot `observedAt` is upstream time or null; `fetchedAt` is local collection time. A successful read of an old sample preserves its old observation time. The fraction `0.05` is stored as `0.05`; future percentage UI converts once to 5%. Signal quality is not alignment.

## Persistence and local context

The Node-only store is `electron/remoteSnapshotStore.ts`, separate from the LAN historian. Version 1 per-account JSON envelopes live in Electron's per-user `remote-v1` directory, outside the repository. One atomic temporary-file/rename commit contains snapshots, refresh attempts, scheduling state and expected-offline metadata. Credential-scoped upstream deadlines have their own small atomic versioned records. No cookies, auth tokens, raw upstream payloads or request URLs are stored here; encrypted credentials remain in `accounts-v1`.

Identical device observations are deduplicated while fetch attempts remain recorded. Re-fetching an old sample updates its fetch provenance without inventing a newer device timestamp. History/attempts are pruned to 90 days on writes and periodically while monitoring; account/session removal does not implicitly purge history. Corrupt/unsupported records remain intact and fail for the affected cache rather than being treated as empty data. Interrupted temporary files are ignored; failed commits leave the prior cache available. Full power-loss durability remains a packaged acceptance check.

Expected-offline notes are local metadata keyed by account and terminal. Host requests still validate current service membership, but the note follows the terminal when it moves to another service in that account. Disabling the note removes it. Notes neither change reported connectivity nor stop tracking, pause a subscription or create a shutdown schedule. The production controls for these settings remain Stage 3; no device mutation is dispatched.

## Typed desktop API

Use the existing trusted main-window `window.dishlink.accountRequest` bridge:

| Request                                                               | Purpose                                                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `{ kind: "remote-cache", context }`                                   | Local selected-terminal snapshot, account refresh state, overdue/error state and expected-offline context. No network request. |
| `{ kind: "remote-refresh", credentialId, accountId }`                 | Shared account job, subject to host cooldown/backoff and ownership checks.                                                     |
| `{ kind: "remote-settings", credentialId, accountId, intervalHours }` | Persist allowed interval and preferred credential for the account. Does not bypass existing backoff.                           |
| `{ kind: "remote-expectation", context, enabled, reason? }`           | Persist local expected-offline context; reason is optional and bounded to 200 characters.                                      |

`context` remains `{credentialId, accountId, serviceLineNumber, terminalId}` and must belong to the saved inventory. Cache reads remain possible for known cached inventory after authentication expires. Live refresh requires a tracked, connected and preferred credential. Errors are generic and never forward upstream exceptions. Existing sender/frame checks apply unchanged.

Packaged multi-account IPC refuses the old diagnostic `read` and inventory `refresh` operations, requiring the scheduler/cache API so a renderer cannot bypass collection limits. Native sign-in/import still validate credentials through their explicit connection flow. The original legacy single-account cloud API is unchanged for compatibility; its migration/source binding belongs to Stage 4. The development panel's direct **Read telemetry** and **Refresh inventory** controls are diagnostics and deliberately remain on-demand in unpackaged runs.

## Development testing

Launch from the isolated worktree with `npm.cmd run dev:electron:win` after clearing `ELECTRON_RUN_AS_NODE` in that launch shell if necessary. The existing development panel now has:

- **Read cached snapshot** for each dish: shows the locally retained snapshot and refresh metadata without an upstream request. A first read may have no snapshot while the startup job is scheduled/running. Times are Unix milliseconds.
- **Refresh snapshots** for each account: requests the shared host job and reports cooldown/backoff errors; use a cached read afterwards to inspect the resulting state.
- Existing raw telemetry/inventory diagnostics and user-operated native sign-in. These diagnostic reads do not establish a two-hour background acceptance run.

The panel remains development-only and exposes no device settings, disconnect/history deletion or expected-offline metadata mutation controls. Production service navigation, accessible status cards and settings presentation remain Stage 3.

## Verification and remaining acceptance

| Check — 2026-10-28                          | Result                                                              |
| ------------------------------------------- | ------------------------------------------------------------------- |
| Full `npm test`                             | 143 files / 1,463 tests passed, including 50 added Stage 2 tests    |
| Typecheck and lint                          | Passed                                                              |
| Extension typecheck/build                   | Passed; new Windows monitor is not claimed supported in extensions  |
| Desktop renderer/main build                 | Passed with pre-existing `platform`/`codeSplitting` option warnings |
| Production renderer check                   | Development panel strings excluded                                  |
| Changed-file formatting and diff whitespace | Passed                                                              |

Tests use the existing installed dependency tree shared from the original checkout. No clean lockfile install, packaged Windows smoke test or real two-hour run is claimed. Development used the isolated `feature/multi-account-stage1` worktree. The user authorized committing and merging the tested work locally into `master` on 2026-10-28; Git history records integration status. Publishing to a remote is separate.

Tests cover strict numeric/null/schema handling; empty/malformed/router-only data; account ownership and one batch read; deduplication/retention/restart/interrupted writes; persistent account and credential deadlines; nine-account scheduling and global/per-login concurrency; shared manual/automatic jobs; retries/cooldown; late responses; sleep/resume; auth isolation; preferred-account deduplication; expected-offline reassignment; lifecycle cleanup; packaged request restrictions; and development panel reads/cooldown feedback.

An independent read-only review found three Important issues (malformed empty data, shared-credential backoff, tracking cadence reset) that were reproduced and fixed with regression tests. The metadata-reassignment finding was treated as Important and fixed too. One Minor remains deferred: real decoder schema failures currently use the generic read-failure/network category instead of the more specific invalid-data category. Such payloads are rejected and cannot mark a dish offline.

Stage 5 still needs real two-hour/window-closed collection, all nine accounts, natural session expiry/reconnection, actual Windows sleep/network transitions, packaged upgrades and power-loss behavior. The user's reported two-week cookie lifetime is operational context, not a fixed validity guarantee or a timer used by the implementation. Automated clocks/mocked upstreams do not prove those live behaviors. No new npm dependency or lockfile change is introduced.

## Implementation decisions

- Keep the remote store under Electron rather than extending the LAN collector. JSON envelopes suit this fleet; a substantially larger history workload may justify a different storage backend later.
- Require cache/scheduler APIs in packaged multi-account requests. Stage 3 must use these APIs rather than copy the development diagnostic flow.
- Keep server deadlines across reconnect/tracking changes. A fresh connection may still wait for an existing upstream backoff.
- Keep expected-offline identity at account/terminal scope while authorizing edits through current service membership. Context intentionally follows the same terminal when its service changes.
