# Stage 3 — Windows account navigation

Implemented on 2026-10-30 in `feature/account-navigation-stage3`, starting at `b32a8db`.

The Windows renderer now opens at Accounts in development and production. Choose an account to see its services, then a service to open remote information. Single-dish services open directly. Services with multiple or replacement terminals require an explicit choice inside the service page. Fragment routes contain validated public account/service/terminal identifiers only.

Remote screens use host snapshots, not the legacy single-login renderer caches. Queries are keyed by credential, account, service and terminal, coalesce concurrent consumers, reject mismatched snapshot identities and discard invalidated responses. Host session changes clear prior results before reloading inventory; account-scoped snapshot events update visible cache readers. A 30-second renderer reconciliation reads host cache only; it never refreshes upstream telemetry. Cloud collection remains Stage 2's scheduler.

## Available controls and information

- Add any number of separately named native logins, reconnect a saved login or import an active session cookie. Cookie input is cleared when submitted and is never persisted by the renderer. Native login cancellation and failed imports preserve existing saved connections.
- Account cards show connection states, service counts and last successful collection. Connections can stop/start background tracking independently of disconnecting. Disconnect requires confirmation and retains cached history and inventory.
- Services show each known terminal's last reported online/offline/unknown state, with accessible text beside green/red/grey dots, observation time, stale indicator and expected-offline context. Inactive services remain in inventory; **subscription state is unavailable**, because the current verified inventory contract supplies no subscription-state field. Device status is not used to infer it.
- Service details show remote source, observation/fetch/next-refresh times, collection failures/overdue status, obstruction percentage, uptime/software/signal values when present and router summaries. The obstruction fraction is multiplied by 100 once; its measurement window/interpretation remains unverified.
- Manual refresh uses the host's five-minute cooldown and longer backoff. A countdown disables refresh while blocked. The account refresh interval can be set to 2, 4, 6, 12 or 24 hours. Successful expected-offline notes do not alter status, tracking or the Starlink subscription.
- Breadcrumbs return to Services and Accounts. Opening an existing main window from the tray returns to Accounts. New windows start at Accounts because no route is persisted.

Independent review found four issues, all fixed with failing-then-passing regression tests: Electron event forwarding from the new window-entry subscription; Back/Forward divergence across local/remote views; loss of an unsaved expected-offline note during unrelated inventory updates; and missing obstruction percentage in the Services overview. Drafts now survive reloads under their full credential/account/service/terminal key, while invalid telemetry is still cleared immediately. Local navigation follows the fragment, including the existing satellite view; directly closing that view returns to the Windows Local monitoring route.

## Boundaries and decisions

The explicit **Local monitoring** entry opens the original dashboard independently of account selection. Remote screens never mount it, its LAN hooks or speed tests. Legacy cache migration, verified LAN/source/control binding and taskbar throughput labeling remain **Stage 4**. Existing background recorder behavior is retained.

Remote active alerts and alignment are excluded. Usage history and billing remain Stage 6. No new upstream routes, LAN polls, dependency packages or device/service writes were added.

New screen messages use the existing translation catalogs and placeholder checks. New account-screen copy currently uses English wording in all five catalogs; translation review remains release work. Existing localized screens retain their translations.

The review retained account-level snapshot provenance when another authorized login collected it; current host membership checks still protect every target. Host scheduling/encryption/pagination remain Stage 1/2 responsibilities, with long-duration scenarios retained for Stage 5.

## Verification

Behavior tests cover concurrent query readers, delayed responses, invalidated credentials/membership, mismatched targets, cache failures, nine accounts/50 services (including a 12-service account), navigation and direct routes, multiple terminals, cancellation/import failure, disconnected cache access, unknown/stale/overdue/error states, percentage scale, holiday notes, manual cooldown, keyboard activation and a 450px window without horizontal overflow. Browser screenshots were inspected at desktop and narrow sizes. The final suite passes **146 files / 1,488 tests**, including 18 account-UI browser tests, six scoped-query/route tests and one real-preload event-boundary test. Typecheck, lint, desktop build, extension typecheck/build and changed-file formatting pass. Existing bundler compatibility/chunk-size warnings remain.

The user subsequently confirmed that the Stage 3 UI looks and works well on 2026-10-30. That confirmation does not replace Stage 5's full-fleet, long-duration and packaged Windows acceptance; synthetic tests do not claim those runs occurred. Existing Stage 2 scheduling/lifecycle tests continue to apply.

To try this branch:

```powershell
cd C:\temp\Starlink\Dishylink\repo\.worktrees\stage3
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm.cmd run dev:electron:win
```

Quit any older Dishylink development instance first because Electron enforces a single running instance. This worktree reuses installed dependencies through a `node_modules` junction. Do not recursively delete through that junction.

## Connection editing and hover follow-up — 2026-10-30

Saved connections now include **Edit name**, opening a prefilled local-name form with Save and Cancel. The host validates the label, persists it through the existing encrypted store and updates the public list. Renaming supports disconnected connections, preserves the credential/cookie, inventory and tracking state, and does not rotate scheduler/session identity or request another sign-in. Failed saves preserve the previous saved name and leave the edit form available to retry.

Account cards keep their shaded hover effect with a brighter surface and border; the account name underlines when any part of the card is hovered. Keyboard focus gets the same name underline and surface emphasis. Dark-theme appearance was inspected in a real-browser screenshot.

Six added behavior tests cover rename persistence/session preservation, failed storage, disconnected rename, invalid input/unknown targets, UI save and UI failure/cancel. No extra packages or Starlink writes.

Follow-up verification: **146 files / 1,494 tests pass**, plus typecheck, lint, extension typecheck, desktop build and changed-file formatting.
