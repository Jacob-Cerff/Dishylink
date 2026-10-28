# Multi-account remote monitoring implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or, if explicitly selected by the user, superpowers:subagent-driven-development to implement this plan task by task. Track progress with the checkboxes and stable task IDs below. Read the design brief and global constraints before executing any stage.

**Status:** Stage 0 complete for the agreed current-fleet scope as of 2026-10-28. User confirms both tested inventories and telemetry match the Starlink portal/app; saved-session reads after relaunch are verified. Stage 1 backend acceptance is complete and Stage 2 implemented with automated verification and independent review; production navigation remains Stage 3. Natural expiry and all-nine-account acceptance remain explicitly in Stage 5.

**Planning-only revision — 2026-10-27:** User priorities below supersede the earlier proposed reduced detail scope. They authorize plan updates only, not implementation of these additions. Essential remote status, alerts and alignment sources required verification at that point; the 2026-10-28 decisions below now supersede the remote alignment and units requirements.

**Stage 0 follow-up authorization — 2026-10-27:** The user subsequently authorized action on the new Stage 0 work. This permits read-only capability investigation and its development diagnostics; it does not authorize implementing the Stage 2/3/6 product features.

**Date:** 2026-10-21 (Australia/Perth)

**Goal:** Let the Windows desktop app retain multiple Starlink logins, discover every accessible dish, refresh remote readings every few hours, and open through Accounts → Services → Service information.

**Architecture:** Extend the existing TypeScript cloud handler with isolated credential sessions and explicit account/service/dish context. Run remote refresh and snapshot storage in Electron main independently of the renderer and local recorder. Give the dashboard a selected-dish data source, using local readings only when the hardware identity matches that selection.

**Tech stack:** Existing React 19, TypeScript, Electron, Vite, Vitest/Playwright, Electron safeStorage, and Node local persistence. No Python runtime or additional hosted service required for the initial release.

**Spec:** The design brief, decisions, and global constraints in this document form the proposed specification. Remote field availability is deliberately subject to Stage 0 verification; this roadmap does not treat untested cloud capabilities as available.

## Design brief

### Current fleet, acceptance and navigation — 2026-10-28

- User reports approximately **50 services across nine separate login accounts**, with an understood limit of about ten services per account. Treat this as the current fleet shape, not a verified universal Starlink limit; do not hard-code a ten-service or nine-account ceiling.
- User confirms **both tested accounts contain all expected items**, and their telemetry agrees with the Starlink portal/app. Together with saved-session reads after relaunch and the known-offline empty example, this completes Stage 0 evidence for the agreed scope. Only two of the nine logins have been live-tested here; full-fleet validation remains Stage 5.
- User reports the current cookie/session lifetime as **two weeks**, subject to Starlink changes. Record it as observed operational context, not a guaranteed expiry or a two-week timer. Renew through the supported session flow, react to actual authentication failures, and request reconnection only for the affected login. Long-duration/natural expiry and recovery remain Stage 5 live acceptance; mocked expiry/refresh tests already exist. No forced revocation or two-week wait is required to finish Stage 0.
- **API pagination** applies to each credential's upstream service inventory, not the sum across logins. `cloud/accountInventory.ts` requests up to 100 service rows per page and follows additional pages when needed. Around 50 services spread across nine accounts do not become one shared 50-row upstream list. Keep tested pagination as defensive compatibility; a live >100-service case is not applicable to the reported fleet and is not a Stage 0 gate. If a future upstream page is smaller or totals indicate more results, enumeration must remain complete.
- **UI navigation is Accounts → Services → Service information.** Accounts home lists the nine connected accounts; selecting one lists only its services. Selecting a service opens its detail in a layout similar to the original local single-dish app. Do not introduce a mandatory extra dish-list screen. If a service has multiple/replacement terminals, handle explicit terminal choice inside the service detail while preserving account/service identity.
- **UI list pagination is a separate presentation choice**, not an API or rate-control mechanism. For the current nine-account/about-ten-services-per-account shape, use readable lists with scrolling; no numbered-page UI is required. Retain stable keys and complete data, and consider optional search/filter or list pagination only when actual list size warrants it. Do not fetch a hidden account's data merely to change a visual page or bypass the scheduler limits on navigation.
- Stage 0 is **done for the agreed current-fleet scope**, with evidence and limitations recorded. The long-duration expiry scenario, all-nine-account scheduling/reconnection and applicable future large-inventory live checks belong to Stage 5; completion does not claim those tests have already occurred.

### Requested behavior and confirmed scope

- Retain multiple independent account sessions concurrently, including sessions supplied through active cookies as in the user's previous Python approach.
- Retrieve telemetry when the monitoring computer is away from the dish's LAN.
- Refresh remote data every few hours across all connected accounts, including accounts not currently open in the UI.
- Always open the main window on an account list. Selecting an account lists all its dishes; selecting a dish opens that dish's readings and service details.
- Target Windows desktop first. Docker/web, macOS validation, and browser extension parity are later work.
- Enterprise/API access is unavailable for these accounts. Use separate native Starlink sign-ins as the primary connection method, with active-cookie import as an alternative.
- Deliver this as an evolving staged plan before implementing features.

### User priorities — 2026-10-27

| Priority                                       | Requirement                                                                                         | Planned stage / evidence gate                                                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Essential                                      | Each service lists its dishes with a green dot for reported online and red dot for reported offline | Verify status source in S0.4; normalize in S2.6; render in S3.3/S3.6. Include text labels and an unknown state.                                                                          |
| Later                                          | Current remote device alerts and warnings                                                           | Deferred to L8 on 2026-10-28. Raw code 82 has no assigned meaning/severity; keep existing development diagnostics separate from planned production features.                             |
| Essential                                      | Obstruction information (remote alignment removed 2026-10-28)                                       | User-confirmed fractional scale: 0.05 means 5%; retain raw fraction, format x100 in S3.6. Alignment already exists locally and is excluded remotely.                                     |
| Essential                                      | Automatic refresh every two hours, with a manual refresh button                                     | S2.3/S2.5 and S3.5; retain five-minute manual cooldown and longer upstream backoff. Two-hour default confirmed; alternative intervals remain optional settings.                          |
| Nice to have                                   | Historical information, primarily data usage                                                        | Stage 6, after the essential release. Existing Stage 2 snapshot storage remains foundational, but does not promise historical usage coverage.                                            |
| Nice to have                                   | Billing information and a billing/history dashboard layout                                          | Stage 6, subject to read-only source and permission verification. No payment or subscription changes.                                                                                    |
| Nice to have, within existing navigation scope | Clicking a service opens information using the same or similar structure as the local app           | S3.4 provides a service overview and selected-dish detail using existing local layout patterns; Stage 6 adds billing/history sections. Multiple terminals require an explicit selection. |
| Later                                          | Other additions beyond the current plan                                                             | Existing Later items remain deferred; do not expand scope automatically.                                                                                                                 |

**Display reference:** Preserve the local app's familiar section order and visual patterns where appropriate. The entry flow remains Accounts → services/dishes → detail. Remote sections show only supported data, with source and observation times; visual similarity does not imply full LAN feature parity. Exact styling can be settled during Stage 3.

**Recommended additions for review:** An unknown status, accessible text beside the coloured dot, observation timestamps, and an optional per-dish “Expected offline” note prevent misleading conclusions. These recommendations are included as unchecked future tasks, not implemented features. The user explicitly notes that unused dishes and sites closed overnight or for holidays can be intentionally offline.

**Device status contract:** Keep reported device state (`online`, `offline`, `unknown`), collection health, and expected operation separate. Green/red indicate the latest valid reported state, labelled “as of …”; grey/unknown applies when there is no reliable status. A stale sample retains its last-reported label with a stale indicator; a failed fetch, expired login, malformed response, old timestamp or unreachable LAN must not create a new offline state. Under the user-confirmed contract, a successful complete read with no selected-dish telemetry represents offline; the user supplied the exact displayed shape `{"deviceTelemetry":{}}` for a known-offline dish on 2026-10-28. Router-only or malformed/incomplete responses remain unknown pending explicit validation; router presence must not imply the dish is online. Online does not promise end-to-end internet health. With two-hour collection this is sampled monitoring, not immediate outage detection.

**Planned inactivity:** Propose a local per-dish “Expected offline” flag with an optional reason, such as unused, site closed or holiday. It adds context beside a genuinely reported red offline state without turning it green, hiding the device or stopping collection. Do not infer planned closure from time of day, turn an unknown into offline, or change/pause the Starlink service. Automatic work-hour/holiday calendars and notification suppression are later scope unless separately requested. Displaying existing warnings is distinct from sending notifications or creating alerts from expected downtime.

### Remote contract decisions — 2026-10-28

**Latest decision — active alerts deferred:** User observed `activeAlerts: [82]` but its meaning/severity is unknown. Move all remote active-alert interpretation, severity mapping and production display to L8. The earlier raw-code test work remains a development diagnostic, not a first-release capability or Stage 0 gate. S0.4 is complete for this revised scope; subsequent inventory/telemetry confirmation closes Stage 0, with natural expiry/full-fleet checks retained in Stage 5. The earlier alert-testing instruction below is retained as history and is superseded by this deferral.

- **Status:** User reports that genuinely offline dishes return empty telemetry and online dishes return information. Adopt presence/absence of selected-dish telemetry after a successful, complete read as the intended status rule, not a guessed numeric service enum. User supplied a known-offline normalized result: `{"deviceTelemetry":{}}`. Record this shape without its terminal identifier; it is not proof that all missing raw rows or router-only responses mean offline. Failures, malformed/truncated responses and expired authentication remain unknown/error, never offline. This is user-confirmed behavior with a supplied offline example, not an independently established universal API guarantee. Stage 2/3 status implementation remains planned.
- **Alerts:** Read and display `ActiveAlerts` as raw numeric `activeAlerts` in the existing development telemetry result. User will identify meanings and severity through testing. Preserve unknown numeric codes, including zero, without assigning names, severity or notifications. Preserve a reported empty array separately from absent/invalid coverage. Record confirmed mappings later with their evidence and scope.
- **Obstruction:** User confirms fractional scale: raw `0.05` means `5%`. Preserve the raw fraction in transport/storage; percentage display multiplies by 100 exactly once. This resolves formatting scale for the plan. Measurement window and whether it describes obstructed time versus physical sky area remain undocumented; do not invent either interpretation. No remote obstruction UI implementation is added by this update.
- **Alignment:** Remove from the remote display and from essential remote capability gates. It already exists locally: `src/App.tsx` opens `AlignmentPanel` from `src/components/alignment/AlignmentCard.tsx`, with rotation, tilt, target angles and alignment error. No Later item is needed to add an existing local feature. Keep the existing local alignment view during Stage 4 integration; do not substitute cloud signal quality.
- **S0.3 disposition:** User remote-scope decisions are recorded. User observed raw code 82 but deferred remote alerts to L8. S0.4 is complete for the revised remote scope; subsequent user inventory/telemetry confirmation closes S0.1. Natural-expiry/full-fleet live validation remains in Stage 5. Historical S0.4 findings below describe the earlier investigation and do not reinstate removed alignment requirements.

### Refresh and storage defaults

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

| Approach                                                             | Fit and trade-off                                                                                                                       | Decision                                                |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Extend the current cookie-backed cloud client                        | Separate native sign-ins with encrypted saved sessions; optional active-cookie import; portal endpoints and response schemas can change | Selected by the user, with Stage 0 verification         |
| Official Starlink telemetry API                                      | Requires API access that the user's accounts do not have                                                                                | Excluded from the current implementation                |
| Collector beside each remote dish, sending data to a central service | Can retain richer LAN telemetry, but requires another machine/service and secure transport at every location                            | Optional later stage if cloud fields prove insufficient |

The user confirmed that Enterprise API access is unavailable. Do not spend Stage 0 investigating official API eligibility or make it a prerequisite for development. Verify the existing session-backed portal flow and its actual remote capabilities instead.

### Development setup and baseline testing

No new npm dependencies are currently proposed. Electron already provides browser-session isolation and safeStorage; Node provides timers and filesystem storage; Vitest and Playwright are already declared for testing. No Python runtime, database server, or external scheduler is needed for this design.

Tooling inspection on 2026-10-21 found Node `v24.18.1` and npm `11.16.0` installed, but no project `node_modules` directory. The repository CI currently uses Node 22. Check the lockfile's engine requirements and establish the baseline before changing Node versions or dependencies; the installed Node 24 environment has not yet been tested with this checkout.

When setup/testing is authorized, run these from the application repository:

```powershell
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run dev:electron:win
```

`npm ci` installs the packages already declared and locked by the repository, including Electron, and runs the existing postinstall script. Playwright's Chromium is a downloaded test browser, not a new application dependency; download it only if the matching browser is absent. Do not edit the manifest or lockfile merely to install the existing toolchain. Start the GUI separately after reviewing its existing startup polling and recorder behavior; a baseline GUI run is not a multi-account feature test.

The current app can establish the pre-change GUI and single-account baseline. Unit/component tests use mocked upstream responses and need neither a live account nor reachable hardware. Later real-account tests are still needed for native sign-in, session persistence, off-LAN telemetry, and multiple independent logins. Those tests use the app's sign-in UI; credentials are not supplied in chat or committed fixtures.

### Existing code that drives the design

| Evidence                                                                                                                    | Consequence                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `cloud/starlinkCloudHandler.ts`: `createCloudHandler()` keeps token and ID state per instance                               | Reuse an instance per credential session, with explicit target context inside it                              |
| `resolveIds()` requests page 0 with limit 100, then takes `results[0]`                                                      | Replace first-service selection with complete paginated inventory and explicit service selection              |
| `/cloud/telemetry` already requests the cloud cache using `accountNumber`                                                   | Remote retrieval has an existing path, but account coverage and field availability need verification          |
| `deviceTelemetryFrom()` currently exposes dish uptime, software, obstruction, and signal quality plus router summary fields | Do not assume its output contains the full local dashboard metrics; inspect upstream legends before extending |
| `electron/cloud.ts` has one handler, one session file, and `persist:starlink-login`                                         | Introduce a registry, per-login encrypted storage, and isolated login partitions                              |
| `src/hooks/useCloudAccount.ts` has singleton account and usage stores                                                       | Replace with account/service-scoped caches and scoped invalidation                                            |
| `src/lib/starlinkCloud.ts` evaluates telemetry freshness with a five-minute threshold                                       | Separate device-reported state from collection age for multi-hour refresh                                     |
| `src/App.tsx` mounts LAN telemetry and router hooks at the application root                                                 | Mount the local dashboard within a selected-dish boundary and prevent unrelated LAN readings from appearing   |
| `electron/collector.ts` and `collector/historian.mts` assume one local recorder/data directory                              | Keep one physical LAN recorder; identify and scope its output before associating it with an account/dish      |
| Router gateway writes cache a controller ID; recorder pause callbacks use the current singleton account                     | Never expose these singleton targeting assumptions across multiple accounts                                   |

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
2. **Account services/dishes:** selected account identity, service grouping, every discovered terminal, friendly name, service location, and last reported online/offline/unknown state with observation time. Show green/red dots and text for verified reported states, grey for unknown, plus expected-offline context where set. Empty, inactive, loading, and reconnect states are represented explicitly.
3. **Service and dish detail:** selecting a service opens an overview using familiar local app sections, with explicit dish selection where more than one terminal exists. Keep account/service/dish identity, obstruction, source label, observation/fetch times and refresh visible. Stage 6 adds verified usage/history and billing sections. Back navigation follows Dish → Service → Account → Accounts; a single-terminal service may open that dish directly with its service identity retained.

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

| Stage | Deliverable                                             | Dependencies              | Status   |
| ----- | ------------------------------------------------------- | ------------------------- | -------- |
| 0     | Verified remote capabilities and approved data contract | None                      | done     |
| 1     | Isolated saved logins and complete inventory            | Stage 0 complete          | done     |
| 2     | Scheduled remote snapshots for every account            | Stage 1                   | done     |
| 3     | Accounts → Services → Service information               | Stages 1–2                | planned  |
| 4     | Local/remote dashboard integration and safe migration   | Stages 1–3                | planned  |
| 5     | Windows release validation and documentation            | Stage 4                   | planned  |
| 6     | Optional usage history and billing dashboards           | Stage 5; verified sources | planned  |
| Later | Other platforms and optional richer remote data         | Separately scoped         | deferred |

## Stage 0 — Verify remote data and finalize contracts

**Closed — 2026-10-28:** Both tested inventories and telemetry match the user's expected portal/app data. Session lifetime is user-reported as two weeks, not a guaranteed constant. >100-service live pagination is not applicable to the current fleet. Remaining long-duration/full-fleet scenarios are explicitly retained in Stage 5 rather than treated as verified. The dated progress below preserves investigation history; the current fleet/acceptance section is authoritative for closure and navigation.

- [x] **S0.0 — Establish the existing Windows baseline.** Install the locked dependencies and matching Playwright Chromium as needed, record Node/npm versions, and run existing typecheck/lint/tests. Review startup network behavior before launching the current desktop app and record its single-account GUI baseline. Keep pre-existing failures separate from later regressions; do not add packages or update the lockfile without a demonstrated requirement. Evidence and clean-install limitation are recorded in the Stage 0 progress section.
- [x] **S0.1 — Map authenticated remote behavior.** Completed for agreed current-fleet scope on 2026-10-28: two independent native logins, off-LAN reads, saved-session reads after relaunch and inventory refresh are verified; user confirms both inventories and telemetry match the portal/app. Current session lifetime is user-reported as two weeks and may change. Real >100-service pagination is not applicable to the reported approximately ten-service-per-account fleet; automated pagination coverage remains. Actual natural expiry/recovery and all-nine-account live acceptance remain explicitly in S5.2, not asserted passed. No production writes.
- [x] **S0.2 — Produce a capability matrix.** Add `docs/remote-telemetry-capabilities.md` listing each desired metric, actual source/legend name, type, units, timestamp semantics, and whether it is snapshot or historical data. Record unavailable fields, permissions, and any pagination or request-rate evidence. Compare the user's previous Python method if they later provide its code; it is not required to finish this planning task.
- [x] **S0.3 — Approve the remote detail scope.** User decisions recorded 2026-10-28: successful-empty telemetry status contract, raw alert-code display for user classification, fractional obstruction conversion and removal of remote alignment. The canonical known-offline empty result is recorded; alert-code validation remains S0.4 work; no collector or new data source is approved.
- [x] **S0.4 — Verify the remaining essential response semantics.** Completed for the agreed Stage 0 scope on 2026-10-28: user supplied known-offline `{"deviceTelemetry":{}}`, confirmed obstruction fraction conversion (0.05 = 5%), removed remote alignment and deferred active alerts to L8 after observing unclassified code 82. Raw schemas and evidence limits are documented. Later status implementation must validate upstream schema and distinguish errors/malformed/partial/router-only responses from the canonical offline shape. No forced production shutdown or new source.

**Acceptance:** Documented evidence that at least two independent sessions can discover their expected inventory and retrieve remote telemetry, or a recorded blocker and revised scope before downstream assumptions become code. No claim that every account type exposes identical data.

### Stage 0 progress — 2026-10-27

**Update — 2026-10-28:** Scope decisions S0.3 are recorded under the current remote contract above. Raw numeric alerts are now exposed for user testing. Obstruction conversion is user-confirmed (fraction x100 for display), and remote alignment is removed; local alignment already exists. The user supplied the known-offline empty result and subsequently deferred alerts to L8; S0.4 is now complete for the revised scope. The dated investigation notes below preserve the earlier evidence, not the current set of unresolved scope choices.

- S0.0: Node `v24.18.1`, npm `11.16.0`; existing typecheck and 93-file/1,120-test Node baseline passed. User explored the original Windows UI without a local dish. Existing browser setup needed `wxt prepare`; the 34-file/217-test browser baseline then passed. Stage 1 subsequently passed full tests, typecheck and lint. Existing installed dependencies are shared into the isolated worktree; no new package or lockfile edit was needed. A clean `npm ci` against the tracked lockfile and CI Node 22 remain separate reproducibility checks.
- S0.1: user confirmed two independent native sign-ins and remote telemetry retrieval. Follow-up relaunched the closed app, loaded both saved connections and successfully read a dish from each without reconnecting; inventory refresh also completed for both. This verifies current-profile persistence and remote reads, not natural expiry or complete portal reconciliation. Initial UI geometry failures were overcome by activating the app and capturing screenshot geometry before input. Expected inventory completeness, real pagination beyond 100 services and natural session expiry remain open.
- S0.2: [capability matrix](../../remote-telemetry-capabilities.md) now records source routes, actual legend mappings, types/units, timestamp semantics, snapshot limitations, permissions, test evidence and outstanding checks. No real response payload or credential is added to fixtures.
- S0.3: user has now specified essential status, alerts/warnings, obstruction/alignment and two-hour/manual refresh, with billing and usage history nice to have. This supersedes the earlier proposed reduced detail scope. Final capability acceptance remains open until S0.4 establishes whether those essentials are available. No collector or extra upstream endpoint has been introduced.
- S0.4: real schema-only audits covered existing account telemetry for both logins and 15 service-detail responses, without storing response values/identifiers. `ActiveAlerts` arrays exist and one dish had numeric entries; code meanings/severity/empty-list coverage remain unverified. `ObstructionPercentTime` is numeric; scale/window remain unverified. All inspected per-terminal `isOffline` values were null; service-level numeric status enums are not mapped. No alignment fields appeared in the inspected sources. See the capability matrix for exact gaps. This task remains partially complete rather than treating these requirements as supported. No new device poll, guessed endpoint or configuration write was introduced.
- Source audit identified legacy numeric coercion, missing-time zero and missing-boolean false defaults. Stage 2 normalization must correct these before storing/presenting the new remote contract; these are not asserted to have occurred in the inspected live result.

## Stage 1 — Isolate sessions and enumerate accounts/dishes

**Backend acceptance closed — 2026-10-28:** User-authorized Stage 2 proceeds because S1.3/S1.4 live acceptance is now satisfied for both tested logins. Independent review regressions and full automated checks are green. Stop tracking and disconnect remain independent, and neither deletes history; production management/history-removal presentation is later UI work. No remaining Stage 1 backend task blocks scheduling/storage. Full-nine-login and natural-expiry acceptance remain Stage 5; other-account/empty-account discovery limits are retained rather than asserted universally solved.

**Likely files:** extend `cloud/starlinkCloudHandler.ts` and its tests; add `core/accountContext.ts`, `cloud/accountRegistry.ts`, `cloud/accountInventory.ts`, `electron/accountStore.ts`, and corresponding tests. Adapt `electron/cloud.ts`, `electron/ipc.ts`, and `electron/preload.ts`. These are proposed boundaries, not files created by this plan.

- [x] **S1.1 — Define identity and request contracts.** Add types for credential/account/service/dish records and validate `DishContext` against registry membership. Test duplicate account access, multiple services, terminal replacement, empty inventory, and malformed target IDs. Use opaque local identifiers for storage paths and partitions; do not build paths from user labels.
- [x] **S1.2 — Add an isolated encrypted session registry.** Implement per-credential read/write/clear operations and one cloud handler per credential. Token refresh is single-flight per credential; account/service caches are scoped within it. Test concurrent refresh, disconnecting one login, reauthentication, failed imports, and late replies after disconnect/reconnect.
- [x] **S1.3 — Add account-specific sign-in/import.** Use `persist:starlink-login-<opaque credentialId>` partitions. Validate a candidate import before replacing a valid session. Reconnect replaces only that credential; disconnect clears only its secret and partition. Separate Stop tracking, Disconnect login, and Delete history actions. Test partition isolation and ensure secret values cannot be read back through IPC.
- [x] **S1.4 — Replace first-service resolution.** Enumerate all result pages and all accessible Starlink accounts using the verified upstream behavior. Fetch service details and all terminals, with bounded concurrency. Scope usage requests to the selected service. Include accounts with zero services and service lines with zero/multiple terminals. Test more than 100 services and inventory changes between refreshes.
- [x] **S1.5 — Introduce scoped read routes.** Add account/service/dish context to cloud read contracts, preserving legacy host interfaces for other platforms where feasible. Keep old mutation routes bound only to a verified legacy/local target; do not let selecting another account retarget a mutation implicitly. Reject arbitrary hosts/URLs and mismatched identities at the main-process boundary.

**Acceptance:** Two saved logins remain independently usable after restart; all their services/dishes can be enumerated without cross-account data, refresh, or sign-out effects. An unselected account can be queried explicitly and a mismatched request is rejected before network I/O.

### Stage 1 progress — 2026-10-27

- [x] **S1.6 — Development-only live test panel (user-approved addition).** Provide two native sign-in buttons, saved account/service/dish inventory, scoped telemetry reads, and clear failures. Expose no device writes or session import/deletion. Gate the panel to desktop development runs and verify exclusion from the production renderer. Three new browser tests passed; full suite now 1,398 tests across 136 files. The user still performs authentication and confirms the real account results.

- Worktree: `C:/temp/Starlink/Dishylink/repo/.worktrees/stage1`, branch `feature/multi-account-stage1`. The original checkout and its pre-existing lockfile/plan edits are preserved.
- User confirmed separate Starlink email logins and no local dish in the office.
- S1.1, S1.2, and S1.5 have implementation and automated verification. S1.3 and S1.4 are now accepted after native sign-in, restart, complete inventory and portal-matching telemetry were verified for both test accounts. The previous pending status is superseded by the 2026-10-28 closure below.
- The Windows bridge exposes isolated native sign-in, validated cookie import, disconnect, tracking state, inventory refresh, and scoped reads. New GUI screens remain Stage 3; no new npm dependencies were added.
- Inventory is derived only from existing portal endpoints and auth identity. Extra empty accounts or accounts not returned by those endpoints are not claimed supported without live evidence. The legacy primary-service path remains for compatibility; new account reads never use it.
- Per-credential metadata/inventory and cookies share one atomic encrypted record. Native reconnect clears only its own browser partition storage first, avoiding automatic reuse of a different user's old browser session after cookie import.
- Independent review identified response-ordering, pagination-completeness, and old native-session reuse cases. Regression tests were observed failing, then passing after fixes. Concurrent inventory requests now share a job; results are accepted only for the current session entry and generation.
- Two real native sign-ins and off-LAN telemetry retrieval are user-confirmed; saved-session reads after relaunch are verified on this Windows profile. The user subsequently confirmed complete expected inventories and portal/app-matching telemetry for both test accounts, closing Stage 0 and Stage 1 backend acceptance. Natural expiry, all-nine-login and packaged acceptance remain Stage 5. Real >100-service pagination is not applicable to the reported current fleet; automated pagination coverage remains. No credential values or real telemetry fixtures are retained in the repository.
- The initial full-suite worktree run required `wxt prepare`; after setup, the existing browser suite passed. Final verification counts and commands are recorded in `docs/multi-account-stage1.md` and the execution ledger.

## Stage 2 — Schedule and store remote snapshots

**Likely files:** add `core/remoteTelemetry.ts`, `cloud/remoteRefresh.ts`, `electron/remoteSnapshotStore.ts`, `electron/remoteMonitoring.ts`, and tests. Integrate lifecycle through `electron/main.ts`; reuse existing persistence utilities where suitable without extending the LAN historian's polling responsibilities.

- [x] **S2.1 — Normalize remote readings.** Decode the Stage 0 verified fields by upstream legend names, with explicit units and source timestamps. Preserve zero as a valid value, reject non-finite values, and distinguish missing fields. Test changed/reordered legends, missing timestamps, unexpected device types, and partial account responses.
- [x] **S2.2 — Add versioned snapshot storage.** Store account/dish/service associations, provenance, fetch outcome, and refresh state. Deduplicate repeated device observations while still recording fetch attempts. Apply the 90-day retention policy and atomic metadata updates. Test interrupted writes, restart recovery, identical terminal IDs under different account contexts, and successful refresh returning an old sample.
- [x] **S2.3 — Implement the host scheduler.** Refresh every tracked account every two hours by default, independently of active UI selection. Each due cycle refreshes inventory, account-wide telemetry and essential status reads under the agreed telemetry-presence contract, with bounded request fan-out. Usage/billing collection is added only when Stage 6 sources are verified and enabled. Fetch account-wide telemetry once per account per cycle. Enforce per-credential serialization and global concurrency of two. Persist due times and respect 429 Retry-After; use bounded exponential backoff with jitter for transient failures, maximum three automatic attempts per failed cycle, then defer to the next regular cycle. Stop auth-failed sessions pending reauthentication. Bound each network operation with a timeout.
- [x] **S2.4 — Handle startup, sleep, and network changes.** Show cache immediately; schedule only missing/due data, stagger overdue jobs, and run at most one catch-up cycle per account after resume. Do not replay missed intervals. Stop/remove jobs when an account is untracked, and discard writes from a superseded session generation. Keep jobs running while the window is closed in the tray.
- [x] **S2.5 — Expose refresh state and manual refresh.** Return next refresh, last attempt/success, last upstream observation, and errors. Enforce the five-minute manual cooldown and longer upstream backoff in the host, including repeated renderer requests. Manual and scheduled work share in-flight jobs rather than duplicate them.
- [x] **S2.6 — Model reported status and obstruction.** Extend `core/remoteTelemetry.ts` and tests with online/offline/unknown state under the agreed successful-empty-telemetry contract, observation/coverage metadata and obstruction fractions (display x100 percent). Preserve last successful values and expose age on refresh failure. Test the canonical valid empty result, populated selected-dish data, failed/malformed/partial responses, router-only ambiguity, stale observations, zero obstruction and reordered legends. Remote alignment is excluded and active-alert interpretation/feature collection is deferred to L8.
- [x] **S2.7 — Store planned inactivity context.** Add optional local per-dish expected-offline flag and reason, keyed by stable account/terminal identity, using versioned metadata in the remote store and validated host requests. Keep this independent of reported status, tracking, credential state and service subscription. Test restart persistence, two accounts with distinct terminals, resetting the flag, and unchanged sampling when expected offline. No remote service writes or automatic schedules.

**Acceptance:** Fake-clock tests prove every account refreshes on schedule with the window absent; one expired session or rate-limited account does not prevent others refreshing. Sleep/restart creates labelled gaps rather than fabricated samples or request floods.

### Stage 2 progress — 2026-10-28

- [x] **S2.8 — Extend development verification controls.** Add account-level **Refresh snapshots** and per-terminal **Read cached snapshot** to the existing development-only panel. Cached reads perform no network work; manual refresh calls the shared scheduler and reports cooldown/backoff failures without a diagnostic-read fallback. Two browser tests cover these paths; production navigation remains Stage 3.
- Implemented strict normalization/status/provenance, account-wide collection, atomic 90-day cache/history, persistent refresh state and credential-level deadlines, bounded clock-driven scheduling, manual/configuration/cache IPC, lifecycle cleanup and stable account/terminal expected-offline notes. See [Stage 2 implementation notes](../../multi-account-stage2.md) for APIs and remaining acceptance.
- Review found three Important issues: malformed empty data, shared-login backoff and cadence reset through tracking updates. All were reproduced RED and corrected. The expected-offline reassignment finding was regraded Important and fixed with a failing regression first. All nine-account/concurrency/cancellation/resume tests are synthetic; no real two-hour collection or sleep/expiry claim is made.
- Verification after fixes: 143 test files / 1,463 tests passed; typecheck and lint passed. Desktop/extension compatibility checks are recorded with final results in the implementation notes. No npm dependency or lockfile changes; existing isolated worktree and branch retained, no merge or publication.
- Deferred Minor: actual malformed upstream schemas use generic read-failure/network classification rather than invalid-data classification. Invalid schemas are rejected and cannot create an offline observation. Keep this distinct from the deferred L8 alert mapping work.

## Stage 3 — Build account-first navigation

**Likely files:** add `src/components/accounts/AccountsHome.tsx`, `AccountDishesView.tsx`, `AccountConnectionDialog.tsx`, `RemoteDishView.tsx`, `src/hooks/useAccountInventory.ts`, and `src/hooks/useAccountRoute.ts`. Adapt `src/App.tsx`, `src/lib/cloudHost.ts`, `src/lib/starlinkCloud.ts`, `src/hooks/useCloudAccount.ts`, and device-list helpers. Extend existing localization resources and real-browser tests.

- [ ] **S3.1 — Replace singleton renderer caches.** Cache by account/service/dish identity, subscribe to scoped events, and ignore late results from prior selections. Test A → B navigation while A is loading, credential replacement, account removal, and simultaneous consumers of the same query.
- [ ] **S3.2 — Create Accounts home and connection flows.** Render the startup list with account/session state, counts, freshness, and add/reconnect/disconnect actions. Provide local-only entry when no account exists. Test empty states, keyboard access, failed import, cancelled login, and returning to Accounts when reopening the main window.
- [ ] **S3.3 — Create the account service list.** After choosing an account, list only that account's services with stable names/IDs, known dish status, timestamps and expected-offline context. Use green/red dots with online/offline text, grey unknown and stale indicators. Retain inactive services with explicit subscription-versus-device labels and distinguish no services from inventory failure. Selecting a service opens its information directly, without a mandatory separate dish-list screen. Test the representative nine-account/about-50-service fleet, account isolation, intentional shutdown, unknown/stale state and accessible labels. Use scrolling for current small lists; no fixed ten-item cap or numbered-page UI requirement.
- [ ] **S3.4 — Add service-first routing and information.** Use validated account/service fragment routes, with terminal context only where necessary. Service information reuses the original local app's section order and component patterns for supported remote fields. A single-terminal service opens directly; multiple/replacement terminals are selected explicitly within that service page rather than adding a mandatory navigation level or silently choosing the first. Breadcrumb/back flow is Service → Account services → Accounts. Reserve usage/history/billing sections for Stage 6. Test direct service routes, single-/multi-terminal cases, account switches, back navigation and target validation. Remote views must not mount LAN polls or display a local speed test as a remote test.
- [ ] **S3.5 — Add source/freshness presentation.** Show “Remote · updated … · next refresh …” and explicit refresh errors while retaining cache. Store device state as last reported/as observed rather than deriving it from time since UI render. An automatic job is overdue after its due time plus 15 minutes; this is collection status, not a declaration that the dish is offline.
- [ ] **S3.6 — Present essential detail and planned inactivity.** In `RemoteDishView.tsx` and the service overview, show status and obstruction using familiar local app layouts, with observation time and coverage. Exclude remote alignment and active-alert display from this release; local alignment/alerts remain existing local capabilities. Format obstruction fractions as percentages, preserving raw values; explain unavailable fields. Add manual refresh with disabled/countdown/backoff feedback under S2.5 and the optional local expected-offline note without controlling the remote service. Test stale/partial data, holiday closure, cooldown and text/keyboard alternatives to colour. No notification delivery.

**Acceptance:** Windows users start at Accounts, select an account to see its Services, then open Service information directly using familiar local-app layouts. Explicit terminal selection stays inside multi-terminal service detail. Users can inspect remote information without a reachable Starlink LAN. Switching selection never shows another account's readings, even briefly.

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
- [ ] **S5.2 — Complete the Windows acceptance matrix.** Verify a representative nine-login/about-50-service fleet (only two logins tested during Stage 0), two-hour refresh with bounded global/per-login concurrency, manual cooldown, off-LAN use, window closed, tray Quit/relaunch, Windows sleep/resume, internet loss, changed inventories, local/remote switching and interrupted migration. Observe natural expiry/reconnection or safely controlled test-session expiry; treat the reported two-week cookie lifetime as changeable, never a fixed validity promise. Ensure one expired login does not affect the other eight. Retain synthetic >100-service tests; perform real multi-page validation only if such an inventory becomes available. Include explicit online/offline/unknown, stale data, obstruction fractional formatting, service navigation and expected-offline context. Remote alert-code mapping/display belongs to L8. Use synthetic/offline fixtures for shutdown cases rather than switching production dishes off. Record results and distinguish mocked behavior from real account observations.
- [ ] **S5.3 — Review information boundaries.** Verify no cookies/tokens in renderer payloads, timing logs, debug copy/export, crash messages, routes, or committed fixtures. Confirm account-target validation and old-session result suppression. Check disk-full/encryption-unavailable behavior without corrupting the previous session or cache.
- [ ] **S5.4 — Update user documentation and package.** Document supported remote fields, refresh intervals, cookie/session renewal, local-only features, retention/removal behavior, and the requirement to keep the app running. Update README, privacy documentation, and changelog to describe the expanded monitoring behavior accurately. Build with `npm run pack:win` and smoke-test a packaged upgrade and fresh install. Publishing is a separate user-authorized action.

**Acceptance:** Documented green required checks plus a packaged Windows acceptance run; any account-specific unsupported telemetry is disclosed in the capability matrix and UI. Release approval is based on the resulting artifact, not this draft roadmap.

## Stage 6 — Optional usage history and billing dashboards

**Priority:** Nice to have, after the essential Windows release; not a Stage 5 release gate. These are planned tasks only. Earlier snapshot persistence is still required for reliable caching and provenance, and is not a promise to reconstruct historical events or billing periods.

**Likely files:** extend `docs/remote-telemetry-capabilities.md`, `cloud/starlinkCloudHandler.ts`, `core/remoteTelemetry.ts`, `collector/remoteSnapshotStore.mts` and their tests; add scoped usage/billing hooks and service-detail sections under `src/components/accounts/`, reusing `src/components/data-usage/` patterns where suitable. Exact source adapters follow read-only discovery, not guessed endpoint paths.

- [ ] **S6.1 — Verify usage history and billing sources.** Inspect the existing selected-service usage route and any separately verified read-only billing source using authorized login permissions. Record billing period boundaries/timezone, usage units/categories, available historical range, partial-period behavior, account-versus-service attribution, currency, invoice/amount/due/payment-status field availability and permission failures. Distinguish usage allowance, subscription price and actual invoice data. No invoice source or field is promised until observed; no purchase/payment/subscription write. Stop and document a permission/source gap rather than widening login privileges.
- [ ] **S6.2 — Collect and persist optional history.** Add typed account/service/period-scoped usage and billing records with source/fetch times, explicit units/currency, independent coverage/error state and configurable collection through the existing scheduler. Preserve upstream period identifiers and distinguish upstream historical records from snapshots collected since installation. Do not sum repeated cumulative usage samples or treat missing periods as zero. Set retention based on the verified historical range and user preference before implementation; the 90-day telemetry default is not automatically a billing retention rule. Test period rollover, duplicate snapshots, corrected invoices/usage, gaps, mixed currencies and one optional source failing without blocking essential telemetry.
- [ ] **S6.3 — Add history and billing sections.** Extend the service detail using local app layout patterns with usage period selection, totals and charts where supported, plus read-only billing summaries. Show coverage, units/currency, source times and unavailable permissions. Keep account-level invoices at account level unless service attribution is explicit. No payment entry/actions or automatic invoice downloads. Test empty/partial history, period selection, multi-service/account isolation, unknown billing attribution and readable narrow-window layouts.
- [ ] **S6.4 — Validate and document optional capability coverage.** Check available real usage/billing reads with the user's read-only accounts, then run appropriate automated and packaged UI checks for the new sections. Document unsupported fields, retention and when history begins. Do not claim older history is backfilled unless the verified upstream source supplies it.

**Acceptance:** Users can inspect available usage history and billing under the correct account/service with clear coverage and familiar navigation. Missing permissions or optional data never degrade essential status/obstruction/refresh behavior, and no financial or service changes are possible through these views.

## Later stages — Other deferred work

- [ ] **L1 — Docker/web:** move the scheduler/credential registry into a persistent server host; define host encryption/secret storage and browser access authentication before exposing account management beyond localhost.
- [ ] **L2 — Browser extensions:** design isolated request authentication and session refresh before adapting the cookie-header rules; a shared browser cookie jar is not sufficient proof of multi-login isolation.
- [ ] **L3 — macOS validation:** validate keychain storage, login partitions, tray lifecycle, background refresh, and migration on macOS.
- [ ] **L4 — Official API provider (out of current scope):** reconsider only if the user later obtains API access and requests it.
- [ ] **L5 — Optional on-site recorder:** separately design authenticated transport and retention if full remote LAN telemetry is needed. No raw dish/router API exposure to the public internet.
- [ ] **L6 — Fleet features:** search/filter accounts and dishes, bulk status summaries, notifications for missed refreshes, and configurable retention/export as separately prioritized additions.
- [ ] **L7 — Planned downtime calendars:** optionally add recurring work hours, site timezone and holiday/closure schedules, plus notification policies if notifications are later requested. The initial expected-offline note is manual context only; never infer connectivity or alter service subscriptions from a calendar.
- [ ] **L8 — Remote active alerts and warnings:** resume verified numeric-code mapping, meaning, severity, coverage/clear-state semantics, observation times and account/dish-scoped display when prioritized. User observed code `82`; its meaning and severity remain unknown. Existing raw `activeAlerts` development output is diagnostic only. Never infer meanings from code numbers, assume LAN boolean keys are equivalent, or add notifications automatically. Add synthetic mapping/unknown-code/partial-response tests before production integration; verify mappings against an authoritative source or documented user observations.

## Review focus

The implementation tasks above must explicitly exercise these risks:

1. A delayed response or token refresh for account A landing after switching/reconnecting to B (S1.2, S3.1).
2. Selecting a remote dish while the unrelated local recorder, alerts, controls, and throughput pill remain active (S4.1–S4.3).
3. A freshly fetched response containing old upstream telemetry, and collection age incorrectly turning a dish offline (S2.2, S3.5).
4. One login exposing several accounts/services, duplicate access through two logins, or inventory exceeding one page (S1.1, S1.4).
5. Sleep/resume, expired credentials, rate limits, encryption failure, or interrupted migration breaking independent background monitoring (S1.2, S2.3–S2.5, S4.4, S5.3).
6. A deliberately powered-off site, unavailable status/alerts, or unverified signal/alignment semantics producing a false failure indication or fabricated measurement (S0.4, S2.6–S2.7, S3.3/S3.6).
7. Cumulative usage counted repeatedly, billing data attributed to the wrong service, or missing history displayed as zero (S6.1–S6.4).

## Updating this plan

- Keep stage and task IDs stable so later conversations can refer to “S2.3” or “Stage 4”.
- Add tasks under the relevant stage; append new stages for substantial new scope.
- For each completed task record its date, files/commit, verification evidence, and any changed assumptions.
- Record blockers against the affected task and its dependents. Independent tasks can remain planned or proceed when authorized.
- Changes to platform scope, data sources, credential handling, or requested navigation update the design brief and affected acceptance criteria together.
- Stage 0 results may reduce or expand the remote dashboard scope. Make that revision explicit before implementing dependent tasks.

## Decision and progress log

| Date       | Decision or update                                                                                    | Basis                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 2026-10-21 | Windows desktop first; other platforms later                                                          | User's explicit platform choice                                                                    |
| 2026-10-21 | Initial plan created; all implementation tasks remain planned                                         | User requested planning only                                                                       |
| 2026-10-21 | Proposed two-hour remote interval and read-only initial remote view                                   | Defaults for review; not yet validated with real accounts                                          |
| 2026-10-21 | Use separate native Starlink sign-ins with encrypted sessions; retain cookie import as an alternative | User confirmed Enterprise API is unavailable and selected the recommended fallback                 |
| 2026-10-21 | Added setup/baseline task S0.0; no new npm packages proposed                                          | Existing manifest includes required runtime and test tools; dependencies are not installed locally |

| 2026-10-27 | Stage 1 authorized in an isolated worktree; separate email logins confirmed | User instruction and clarification |
| 2026-10-27 | Two separate logins and remote telemetry confirmed; Stage 0 capability matrix added | User live-test confirmation plus read-only panel/source inspection; remaining live checks explicitly open |
| 2026-10-27 | Added essential status, current alerts, obstruction/alignment and two-hour/manual refresh; retained local layout reference | User priority list; planning only, essential sources still require S0.4 verification |
| 2026-10-27 | Added optional Stage 6 for usage history and billing; proposed unknown/expected-offline context and deferred calendars | User nice-to-have priorities and intentional shutdown context; recommendations clearly distinguished from confirmed requirements |
| 2026-10-27 | Executed S0.4 read-only schema investigation and verified both saved-session reads after app relaunch | Existing telemetry/service-detail routes only; exact essential-field gaps recorded in capability matrix, no production telemetry feature added |
| 2026-10-28 | Accepted user status/obstruction contract, exposed raw ActiveAlerts for testing, removed remote alignment | User instruction; local alignment already exists; exact offline shape and alert-code meanings/severity remain user verification |
| 2026-10-28 | Deferred remote active alerts to L8 after user observed code 82; closed S0.4 for revised scope | User instruction; no code meaning/severity inferred; S0.1 inventory/session-lifecycle checks remain open |
| 2026-10-28 | Closed Stage 1 backend acceptance and implemented Stage 2 with development cache/refresh controls | User conditionally authorized Stage 2; previous two-login checks satisfy Stage 1, fake clocks/full tests/review verify Stage 2; real lifecycle/full-fleet release checks remain Stage 5 |
| 2026-10-28 | User authorized committing and merging the tested Stage 1/2 work locally into master | Preserve pre-existing lockfile edits and incorporated earlier plan changes; no remote push requested |
