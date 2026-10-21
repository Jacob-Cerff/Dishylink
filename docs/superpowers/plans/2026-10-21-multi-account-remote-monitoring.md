# Multi-account remote monitoring implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or, if explicitly selected by the user, superpowers:subagent-driven-development to implement this plan task by task. Track progress with the checkboxes and stable task IDs below. Read the design brief and global constraints before executing any stage.

**Status:** Draft roadmap for review. Planning only; no feature implementation authorized by this document.

**Date:** 2026-10-21 (Australia/Perth)

**Goal:** Let the Windows desktop app retain multiple Starlink logins, discover every accessible dish, refresh remote readings every few hours, and open through Accounts → Dishes → Dish telemetry.

**Architecture:** Extend the existing TypeScript cloud handler with isolated credential sessions and explicit account/service/dish context. Run remote refresh and snapshot storage in Electron main independently of the renderer and local recorder. Give the dashboard a selected-dish data source, using local readings only when the hardware identity matches that selection.

**Tech stack:** Existing React 19, TypeScript, Electron, Vite, Vitest/Playwright, Electron safeStorage, and Node local persistence. No Python runtime or additional hosted service required for the initial release.

**Spec:** The design brief, decisions, and global constraints in this document form the proposed specification. Remote field availability is deliberately subject to Stage 0 verification; this roadmap does not treat untested cloud capabilities as available.

## Design brief

### Requested behavior and confirmed scope

- Retain multiple independent account sessions concurrently, including sessions supplied through active cookies as in the user's previous Python approach.
- Retrieve telemetry when the monitoring computer is away from the dish's LAN.
- Refresh remote data every few hours across all connected accounts, including accounts not currently open in the UI.
- Always open the main window on an account list. Selecting an account lists all its dishes; selecting a dish opens that dish's readings and service details.
- Target Windows desktop first. Docker/web, macOS validation, and browser extension parity are later work.
- Deliver this as an evolving staged plan before implementing features.

### Proposed defaults, adjustable during review

- Remote automatic refresh: every **2 hours**, configurable per account to 2, 4, 6, 12, or 24 hours.
- One shared app scheduler; maximum two cloud refresh jobs in flight globally and one per credential session. Add small startup/scheduling jitter to avoid synchronized bursts.
- Manual refresh is available with a **5-minute cooldown**; an upstream Retry-After or longer backoff takes precedence. It does not change the automatic interval or enable fast polling.
- Cloud monitoring is read-only initially. Preserve existing local controls only after their target and account binding are verified.
- Retain remote snapshots for **90 days** initially. Retention and account removal are explicit settings; removing a login does not silently delete history.
- Cached pages open immediately. Navigation alone does not bypass refresh limits.
- Background refresh runs while Electron is running, including with its window closed in the tray. It cannot run while Windows is asleep, the app is quit, or the computer is off.

### How the previous Python cookie approach fits

The project already accepts a cookie string containing `Starlink.Com.Sso`, refreshes its access cookie, and calls Starlink's account and telemetry endpoints. Reuse that request flow rather than adding a Python sidecar. Each login receives its own encrypted cookie record, token-refresh state, handler instance, login browser partition, and account mappings.

Support both **Sign in to Starlink** and **Import active session cookie** in the privileged desktop host. Imports must be validated before becoming the active session, and raw cookies must not be returned to the renderer after submission. Existing native sign-in remains the preferred routine workflow; importing supports the user's existing method.

An active cookie is a renewable session only as far as Starlink permits. Sessions can expire, be revoked, or need interactive sign-in. Display that state for the affected login without disconnecting other logins. Never promise that saved accounts remain authenticated indefinitely. Do not request real cookie values in chat or store them in this repository.

### Approaches considered

| Approach | Fit and trade-off | Decision |
| --- | --- | --- |
| Extend the current cookie-backed cloud client | Closest fit to existing code and the user's working method; portal endpoints and response schemas can change | Recommended initial approach, with Stage 0 verification |
| Official Starlink telemetry API | Intended for remote device monitoring; account eligibility/access and exposed metrics must be checked | Keep as a future provider option if the user's accounts have access |
| Collector beside each remote dish, sending data to a central service | Can retain richer LAN telemetry, but requires another machine/service and secure transport at every location | Optional later stage if cloud fields prove insufficient |

Starlink describes its telemetry API as supporting remote device monitoring and directs users to obtain access through an account manager. Do not assume ordinary portal cookies grant official API access. Source: [Starlink telemetry API help](https://starlink.com/rw/support/article/90109cc2-c7ec-31ff-d160-0a87f16ef759), consulted 2026-10-21. The linked API documentation was not readable through the research tool; endpoint eligibility and detailed official API semantics remain unverified.

### Existing code that drives the design

| Evidence | Consequence |
| --- | --- |
| `cloud/starlinkCloudHandler.ts`: `createCloudHandler()` keeps token and ID state per instance | Reuse an instance per credential session, with explicit target context inside it |
| `resolveIds()` requests page 0 with limit 100, then takes `results[0]` | Replace first-service selection with complete paginated inventory and explicit service selection |
| `/cloud/telemetry` already requests the cloud cache using `accountNumber` | Remote retrieval has an existing path, but account coverage and field availability need verification |
| `deviceTelemetryFrom()` currently exposes dish uptime, software, obstruction, and signal quality plus router summary fields | Do not assume its output contains the full local dashboard metrics; inspect upstream legends before extending |
| `electron/cloud.ts` has one handler, one session file, and `persist:starlink-login` | Introduce a registry, per-login encrypted storage, and isolated login partitions |
| `src/hooks/useCloudAccount.ts` has singleton account and usage stores | Replace with account/service-scoped caches and scoped invalidation |
| `src/lib/starlinkCloud.ts` evaluates telemetry freshness with a five-minute threshold | Separate device-reported state from collection age for multi-hour refresh |
| `src/App.tsx` mounts LAN telemetry and router hooks at the application root | Mount the local dashboard within a selected-dish boundary and prevent unrelated LAN readings from appearing |
| `electron/collector.ts` and `collector/historian.mts` assume one local recorder/data directory | Keep one physical LAN recorder; identify and scope its output before associating it with an account/dish |
| Router gateway writes cache a controller ID; recorder pause callbacks use the current singleton account | Never expose these singleton targeting assumptions across multiple accounts |

These observations come from source inspection, not authenticated remote tests. No hardware or user credentials were accessed during planning.

### Identity and storage model

Keep logins, Starlink accounts, services, and dishes distinct. One login might access multiple Starlink accounts; one account can have multiple service lines; a service line can have multiple or replacement terminals.

- `CredentialSession`: opaque local `credentialId`, user label, encrypted secret reference, validated identity metadata, and authentication state.
- `AccountRef`: stable Starlink `accountId` and display metadata; credential access is a separate mapping. If two logins expose the same account, show one account row and require a preferred credential for refresh, without fetching it twice.
- `ServiceRef`: `(accountId, serviceLineNumber)`, nickname, address, plan, and subscription state.
- `DishRef`: `(accountId, terminalId)`, associated service references, serial information, router IDs, and supported capabilities. Preserve recorded service association when a terminal moves; revalidate current membership before requests.
- `DishContext`: explicit `credentialId`, `accountId`, `serviceLineNumber`, and `terminalId`. Never infer these from a global current account or first list entry.
- `RemoteSnapshot`: account/dish identity, service association at capture time, `source: cloud`, upstream `observedAt`, local `fetchedAt`, supported metrics with units, and refresh outcome. Missing metrics are absent/null, never fabricated zeros.
- `RefreshState`: next due time, last attempt, last success, backoff deadline, and authentication state; stored independently from the latest successful snapshot.

Public account metadata and snapshots live under the existing per-user application data directory with versioned schemas. Secrets live in a separate encrypted store. Cache keys include account and terminal identity; usage keys also include service identity and billing period. Credential replacement invalidates responses fetched under the old credential generation.

Define a remote-provider boundary with operations equivalent to `listInventory(credentialId)`, `fetchAccountTelemetry(credentialId, accountId)`, and `fetchServiceUsage(context)`. Keep portal endpoint details in the cloud adapter. If telemetry returns a whole account in one response, fetch once and distribute rows by terminal; do not fetch that same account payload once per dish.

### GUI and data-source behavior

1. **Accounts home:** account labels, identity metadata, dish count, session status, last successful refresh, next refresh, Add account, and per-account refresh. The empty state offers connection/import and an explicit option to use a local dish without an account.
2. **Account dishes:** selected account identity, service grouping, every discovered terminal, friendly name, service location, and last known state with observation time. Empty, inactive, loading, and reconnect states are represented explicitly.
3. **Dish telemetry:** persistent account/service/dish identity, source label, observation/fetch times, refresh action, available telemetry, plan/usage details, and supported local features. Back navigation follows Dish → Account → Accounts.

Every new launch/open-window action returns to Accounts home. Refresh state and inventory survive restarts; route restoration must not skip the account list. Within an open session, back/forward navigation can use the existing fragment-based routing approach. Route IDs contain no secrets and are checked against the registry on navigation.

Remote mode displays scheduled snapshots and supported history. Local mode can display the existing richer live readings only after comparing the local terminal's hardware/API identity with the selected terminal. An inability to reach a dish locally means **remote access**, not proof that the remote dish is offline. Unknown identity must not authorize local control or attach local history.

Show collection state (current, overdue, refresh failed, authentication required) separately from device state. A two-hour-old snapshot is labelled with its timestamp; it does not automatically become a new offline event after five minutes. If an upstream response contains an older sample, preserve its old observation time even when the fetch just succeeded. Do not draw continuous high-resolution lines, integrate energy, or claim outage durations across multi-hour gaps.

Cloud fields not supported by the validated response get an explanatory unavailable state. In particular, detailed obstruction maps, alignment, power, per-client counters, and LAN controls must not be advertised as remotely available without evidence. A speed test on the monitoring PC measures that PC's connection, so disable it in remote dish mode rather than attributing it to the selected dish.

## Global constraints

- Windows desktop first; other platforms must keep their current build behavior until their own migration stage.
- Planning only until the user requests implementation; no production login, polling experiment, dependency installation, or deployment is part of this plan-writing task.
- Never print, commit, include in diagnostics, or expose stored session cookies/tokens through renderer read APIs.
- Use Electron safeStorage for credential persistence; if encryption is unavailable, offer temporary memory-only use or fail clearly rather than silently writing plaintext.
- Validate account/service/dish ownership in the trusted host on every scoped request. Reject unknown IDs and mismatched combinations before any upstream call.
- No new router poll and no router `get_ping` call. Reuse established LAN reads and respect `CLAUDE.md` hardware constraints.
- No account-wide arbitrary device selection for writes. Existing local automation must fail closed if its dish/account binding is ambiguous or unvalidated.
- Keep cloud snapshots separate from LAN samples; never invent history or attribute unlabelled legacy records to the selected remote dish.
- Keep the app usable locally without account login through an explicit path from Accounts home.
- Do not extend auto-pausing/rule enforcement to remote snapshot data in this release.

## Stage tracker

Status values: `planned`, `in progress`, `blocked`, `done`, `deferred`. A checked task requires its acceptance evidence; update this table when the work actually changes state.

| Stage | Deliverable | Dependencies | Status |
| --- | --- | --- | --- |
| 0 | Verified remote capabilities and approved data contract | None | planned |
| 1 | Isolated saved logins and complete inventory | Stage 0 | planned |
| 2 | Scheduled remote snapshots for every account | Stage 1 | planned |
| 3 | Accounts → Dishes → remote detail navigation | Stages 1–2 | planned |
| 4 | Local/remote dashboard integration and safe migration | Stages 1–3 | planned |
| 5 | Windows release validation and documentation | Stage 4 | planned |
| Later | Other platforms and optional richer remote data | Separately scoped | deferred |

## Stage 0 — Verify remote data and finalize contracts

- [ ] **S0.1 — Map authenticated remote behavior.** During a later implementation session, validate the existing cookie flow on an internet connection away from the Starlink LAN using a host-local credential supplied through the app. Capture only redacted fixtures. Check expiry/refresh, pagination, account switching, service memberships, and telemetry coverage. Never use production write endpoints for discovery.
- [ ] **S0.2 — Produce a capability matrix.** Add `docs/remote-telemetry-capabilities.md` listing each desired metric, actual source/legend name, type, units, timestamp semantics, and whether it is snapshot or historical data. Record unavailable fields, permissions, and any pagination or request-rate evidence. Compare the user's previous Python method if they later provide its code; it is not required to finish this planning task.
- [ ] **S0.3 — Approve the remote detail scope.** Decide whether the observed cloud fields satisfy the first release. If essential readings are absent, explicitly choose reduced remote detail, eligible official API access, or a separately scoped on-site collector. Do not silently implement a different source.

**Acceptance:** Documented evidence that at least two independent sessions can discover their expected inventory and retrieve remote telemetry, or a recorded blocker and revised scope before downstream assumptions become code. No claim that every account type exposes identical data.

## Stage 1 — Isolate sessions and enumerate accounts/dishes

**Likely files:** extend `cloud/starlinkCloudHandler.ts` and its tests; add `core/accountContext.ts`, `cloud/accountRegistry.ts`, `cloud/accountInventory.ts`, `electron/accountStore.ts`, and corresponding tests. Adapt `electron/cloud.ts`, `electron/ipc.ts`, and `electron/preload.ts`. These are proposed boundaries, not files created by this plan.

- [ ] **S1.1 — Define identity and request contracts.** Add types for credential/account/service/dish records and validate `DishContext` against registry membership. Test duplicate account access, multiple services, terminal replacement, empty inventory, and malformed target IDs. Use opaque local identifiers for storage paths and partitions; do not build paths from user labels.
- [ ] **S1.2 — Add an isolated encrypted session registry.** Implement per-credential read/write/clear operations and one cloud handler per credential. Token refresh is single-flight per credential; account/service caches are scoped within it. Test concurrent refresh, disconnecting one login, reauthentication, failed imports, and late replies after disconnect/reconnect.
- [ ] **S1.3 — Add account-specific sign-in/import.** Use `persist:starlink-login-<opaque credentialId>` partitions. Validate a candidate import before replacing a valid session. Reconnect replaces only that credential; disconnect clears only its secret and partition. Separate Stop tracking, Disconnect login, and Delete history actions. Test partition isolation and ensure secret values cannot be read back through IPC.
- [ ] **S1.4 — Replace first-service resolution.** Enumerate all result pages and all accessible Starlink accounts using the verified upstream behavior. Fetch service details and all terminals, with bounded concurrency. Scope usage requests to the selected service. Include accounts with zero services and service lines with zero/multiple terminals. Test more than 100 services and inventory changes between refreshes.
- [ ] **S1.5 — Introduce scoped read routes.** Add account/service/dish context to cloud read contracts, preserving legacy host interfaces for other platforms where feasible. Keep old mutation routes bound only to a verified legacy/local target; do not let selecting another account retarget a mutation implicitly. Reject arbitrary hosts/URLs and mismatched identities at the main-process boundary.

**Acceptance:** Two saved logins remain independently usable after restart; all their services/dishes can be enumerated without cross-account data, refresh, or sign-out effects. An unselected account can be queried explicitly and a mismatched request is rejected before network I/O.

## Stage 2 — Schedule and store remote snapshots

**Likely files:** add `core/remoteTelemetry.ts`, `cloud/remoteRefresh.ts`, `collector/remoteSnapshotStore.mts`, `electron/remoteMonitoring.ts`, and tests. Integrate lifecycle through `electron/main.ts`; reuse existing persistence utilities where suitable without extending the LAN historian's polling responsibilities.

- [ ] **S2.1 — Normalize remote readings.** Decode the Stage 0 verified fields by upstream legend names, with explicit units and source timestamps. Preserve zero as a valid value, reject non-finite values, and distinguish missing fields. Test changed/reordered legends, missing timestamps, unexpected device types, and partial account responses.
- [ ] **S2.2 — Add versioned snapshot storage.** Store account/dish/service associations, provenance, fetch outcome, and refresh state. Deduplicate repeated device observations while still recording fetch attempts. Apply the 90-day retention policy and atomic metadata updates. Test interrupted writes, restart recovery, identical terminal IDs under different account contexts, and successful refresh returning an old sample.
- [ ] **S2.3 — Implement the host scheduler.** Refresh every tracked account at its configured interval, independently of active UI selection. Each due cycle refreshes inventory, account-wide telemetry, and usage for its tracked services, with bounded request fan-out. Fetch account-wide telemetry once per account per cycle. Enforce per-credential serialization and global concurrency of two. Persist due times and respect 429 Retry-After; use bounded exponential backoff with jitter for transient failures, maximum three automatic attempts per failed cycle, then defer to the next regular cycle. Stop auth-failed sessions pending reauthentication. Bound each network operation with a timeout.
- [ ] **S2.4 — Handle startup, sleep, and network changes.** Show cache immediately; schedule only missing/due data, stagger overdue jobs, and run at most one catch-up cycle per account after resume. Do not replay missed intervals. Stop/remove jobs when an account is untracked, and discard writes from a superseded session generation. Keep jobs running while the window is closed in the tray.
- [ ] **S2.5 — Expose refresh state and manual refresh.** Return next refresh, last attempt/success, last upstream observation, and errors. Enforce the five-minute manual cooldown and longer upstream backoff in the host, including repeated renderer requests. Manual and scheduled work share in-flight jobs rather than duplicate them.

**Acceptance:** Fake-clock tests prove every account refreshes on schedule with the window absent; one expired session or rate-limited account does not prevent others refreshing. Sleep/restart creates labelled gaps rather than fabricated samples or request floods.

## Stage 3 — Build account-first navigation

**Likely files:** add `src/components/accounts/AccountsHome.tsx`, `AccountDishesView.tsx`, `AccountConnectionDialog.tsx`, `RemoteDishView.tsx`, `src/hooks/useAccountInventory.ts`, and `src/hooks/useAccountRoute.ts`. Adapt `src/App.tsx`, `src/lib/cloudHost.ts`, `src/lib/starlinkCloud.ts`, `src/hooks/useCloudAccount.ts`, and device-list helpers. Extend existing localization resources and real-browser tests.

- [ ] **S3.1 — Replace singleton renderer caches.** Cache by account/service/dish identity, subscribe to scoped events, and ignore late results from prior selections. Test A → B navigation while A is loading, credential replacement, account removal, and simultaneous consumers of the same query.
- [ ] **S3.2 — Create Accounts home and connection flows.** Render the startup list with account/session state, counts, freshness, and add/reconnect/disconnect actions. Provide local-only entry when no account exists. Test empty states, keyboard access, failed import, cancelled login, and returning to Accounts when reopening the main window.
- [ ] **S3.3 — Create the account dish list.** Group dishes by service, show stable names/IDs and timestamps, and retain inactive devices with appropriate labels. Distinguish no dishes from inventory fetch failure. Test multiple services, routers under the correct terminal, and pagination results exceeding the first page.
- [ ] **S3.4 — Add explicit routing and remote detail.** Use fragment routes for account and terminal IDs with validated service context. Keep breadcrumbs/back navigation and selected identity visible. Display supported snapshots and usage; unavailable features explain their limitation. A remote view must not mount LAN polling hooks or display a local speed test as a remote test.
- [ ] **S3.5 — Add source/freshness presentation.** Show “Remote · updated … · next refresh …” and explicit refresh errors while retaining cache. Store device state as last reported/as observed rather than deriving it from time since UI render. An automatic job is overdue after its due time plus 15 minutes; this is collection status, not a declaration that the dish is offline.

**Acceptance:** New and existing Windows users start at Accounts, can navigate every account and dish, and can inspect remote information without any reachable Starlink LAN. Switching selection never shows another account's readings, even briefly.

## Stage 4 — Integrate live LAN views and migrate existing state

**Likely files:** add `src/hooks/useSelectedDishTelemetry.ts` and a selected-dish provider boundary. Adapt `src/hooks/useDishTelemetry.ts`, `src/hooks/useRouterNetwork.ts`, dashboard/panel entry points, `electron/collector.ts`, historian identity/storage interfaces, `electron/throughputWidget.ts`, and existing settings/rule callbacks.

- [ ] **S4.1 — Define capability-based source selection.** A verified local terminal ID permits live local data for that terminal; all others use cloud snapshots. Reuse existing device-info/status reads to bind the local recorder. Gate the existing recorder startup and fast LAN loops so remote-only use does not continuously retry unreachable LAN devices. Use bounded identity checks on explicit local connection or network changes, without adding a router discovery/poll loop. A verified local recorder may continue for its own dish while another remote dish is selected. Unknown local identity is unassigned and cannot authorize local controls. Test that remote-only startup leaves high-frequency LAN loops stopped.
- [ ] **S4.2 — Scope local recordings and dashboards.** Associate new LAN records with a stable terminal identity and service association when known, independently of whichever account is selected. Keep separate provenance when showing local and remote data together. Do not feed sparse cloud snapshots into local per-second energy integration or outage synthesis. Test moving between two LANs and selecting a remote dish while the local recorder continues working.
- [ ] **S4.3 — Bind controls, alerts, and automation.** Existing local controls and rule pausing require an explicitly verified credential/account/service/router association. Ambiguity disables the action with a clear reason. Preserve self-pause protection. Keep remote views read-only and local recorder alerts labelled with their true device. The Windows throughput pill must identify its local source or stop displaying that rate for a selected remote dish.
- [ ] **S4.4 — Migrate legacy single-session storage.** Import the existing encrypted desktop session into the registry once and validate it before marking migration complete. Preserve the previous file until the new write and verification succeed. Handle invalid sessions as reconnect-required without losing history. Keep unlabelled legacy history as “Legacy local history” until identity can be established; never auto-assign it to the first account/dish. Test retrying interrupted migration and repeat startup.
- [ ] **S4.5 — Preserve platform boundaries.** Make scoped Windows APIs capability-negotiated; keep the existing single-session adapters for extension/web builds until migrated. Re-run their existing typechecks and builds. Do not claim other platforms have the new functionality solely because shared types compile.

**Acceptance:** Local monitoring still works through the account-first entry flow, remote selections never inherit unrelated local readings or actions, and upgrading preserves existing credentials/history safely. Existing local automation runs only for its verified original target or pauses pending resolution.

## Stage 5 — Validate and package the Windows release

- [ ] **S5.1 — Run focused and full automated checks.** Use failing behavior tests before implementation in each earlier task. At this stage run `npm run typecheck`, `npm run lint`, and `npm test`; format-check changed files. Run relevant extension typecheck/build checks for shared-code changes. Tests use fake credentials and redacted upstream fixtures.
- [ ] **S5.2 — Complete the Windows acceptance matrix.** Verify two logins with multiple dishes/services, two-hour refresh, manual cooldown, off-LAN use, window closed, tray Quit/relaunch, Windows sleep/resume, internet loss, one session expiry, changed inventories, local/remote source switching, and interrupted migration. Record results and distinguish mocked behavior from real account observations.
- [ ] **S5.3 — Review information boundaries.** Verify no cookies/tokens in renderer payloads, timing logs, debug copy/export, crash messages, routes, or committed fixtures. Confirm account-target validation and old-session result suppression. Check disk-full/encryption-unavailable behavior without corrupting the previous session or cache.
- [ ] **S5.4 — Update user documentation and package.** Document supported remote fields, refresh intervals, cookie/session renewal, local-only features, retention/removal behavior, and the requirement to keep the app running. Update README, privacy documentation, and changelog to describe the expanded monitoring behavior accurately. Build with `npm run pack:win` and smoke-test a packaged upgrade and fresh install. Publishing is a separate user-authorized action.

**Acceptance:** Documented green required checks plus a packaged Windows acceptance run; any account-specific unsupported telemetry is disclosed in the capability matrix and UI. Release approval is based on the resulting artifact, not this draft roadmap.

## Later stages — Keep out of the first release

- [ ] **L1 — Docker/web:** move the scheduler/credential registry into a persistent server host; define host encryption/secret storage and browser access authentication before exposing account management beyond localhost.
- [ ] **L2 — Browser extensions:** design isolated request authentication and session refresh before adapting the cookie-header rules; a shared browser cookie jar is not sufficient proof of multi-login isolation.
- [ ] **L3 — macOS validation:** validate keychain storage, login partitions, tray lifecycle, background refresh, and migration on macOS.
- [ ] **L4 — Official API provider:** add a provider only after account eligibility, authentication, limits, and field parity are verified.
- [ ] **L5 — Optional on-site recorder:** separately design authenticated transport and retention if full remote LAN telemetry is needed. No raw dish/router API exposure to the public internet.
- [ ] **L6 — Fleet features:** search/filter accounts and dishes, bulk status summaries, notifications for missed refreshes, and configurable retention/export as separately prioritized additions.

## Review focus

The implementation tasks above must explicitly exercise these risks:

1. A delayed response or token refresh for account A landing after switching/reconnecting to B (S1.2, S3.1).
2. Selecting a remote dish while the unrelated local recorder, alerts, controls, and throughput pill remain active (S4.1–S4.3).
3. A freshly fetched response containing old upstream telemetry, and collection age incorrectly turning a dish offline (S2.2, S3.5).
4. One login exposing several accounts/services, duplicate access through two logins, or inventory exceeding one page (S1.1, S1.4).
5. Sleep/resume, expired credentials, rate limits, encryption failure, or interrupted migration breaking independent background monitoring (S1.2, S2.3–S2.5, S4.4, S5.3).

## Updating this plan

- Keep stage and task IDs stable so later conversations can refer to “S2.3” or “Stage 4”.
- Add tasks under the relevant stage; append new stages for substantial new scope.
- For each completed task record its date, files/commit, verification evidence, and any changed assumptions.
- Record blockers against the affected task and its dependents. Independent tasks can remain planned or proceed when authorized.
- Changes to platform scope, data sources, credential handling, or requested navigation update the design brief and affected acceptance criteria together.
- Stage 0 results may reduce or expand the remote dashboard scope. Make that revision explicit before implementing dependent tasks.

## Decision and progress log

| Date | Decision or update | Basis |
| --- | --- | --- |
| 2026-10-21 | Windows desktop first; other platforms later | User's explicit platform choice |
| 2026-10-21 | Initial plan created; all implementation tasks remain planned | User requested planning only |
| 2026-10-21 | Proposed two-hour remote interval and read-only initial remote view | Defaults for review; not yet validated with real accounts |
