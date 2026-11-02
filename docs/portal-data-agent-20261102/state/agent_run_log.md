# Resource → Portal → Data Agent delivery

- Run: 20261102-resource-data-agent; owner: root; mode: Controlled (cross-repository authentication contract).
- Scope: reuse Portal exchange API, add nested bridge, preserve FineReport entry; no main merge, deployment, live database or vendor calls.
- Resource baseline: `1a3bca0`, branch `feature/portal-data-agent-bridge`.
- Portal worktree: `shell-oneportal-resource-bridge`, branch `feature/resource-data-agent-bridge`, baseline `8d2e1b8`; 33 git-visible prerequisite files copied from completed first-layer work. Original dirty checkout preserved; overlay hashes in ignored `.local/resource-bridge/baseline-overlay.json`.

## Plan / UX / contract freeze

- Backend keeps `/api/data-agent/launch`; optional parentInstanceId and additive targetOrigin. Session and registered parent determine identity; parent/target permissions checked before and after vendor call. Nested parent app allowlist defaults empty.
- Separate `portal-data-agent` 1.0 messages REQUEST/GRANT/ERROR/CANCEL. Exact origin/source/instance/request binding. Existing `portal-embed` JWT flow unchanged.
- Child lazy-launches existing Agent tab; collapse keeps frame, retry/refresh gets a new ticket; expired/changed session clears it. No token links, storage, caller email, or inferred vendor-login success from iframe load.
- Synthetic HTTPS vendor and Alice/Bob browser tests; live vendor CSP/cookies/authorization remain UAT work.

## Dispatch

| Ticket | Route / semantic risk | Contract change | Owner / executor | Regression / escalation |
|---|---|---|---|---|
| Contract | decision / high | yes | root / bridge_contract | integration_review / root |
| Portal backend | domain / high | optional parent + origin | root / receiver_backend | integration_review / bridge_contract |
| SDK | domain / high | separate additive protocol | root / jwt_verifier | integration_review / bridge_contract |
| Resource frontend | domain / medium | SDK consumer | root / receiver_frontend | integration_review / bridge_contract |
| Portal frontend + fixture | domain / medium | SDK/API adapter | root / root | integration_review / bridge_contract |

## Progress

- INTAKE / BASELINE: authorized second layer; independent feature worktrees established, original Portal changes protected.
- EXPLORATION / PLAN: current vendor API and session scope invalidation verified; planner selected for shared authentication semantics.
- PRODUCT_UX_GATE / CONTRACT_FREEZE: existing navigation retained; loading/retry/collapse/expiry behavior frozen above.
- DISPATCH: non-overlapping ownership, no commits or live actions by workers; retained for immediate integration/rework.
- INTEGRATE: two repositories built; nine SDK source files copied unchanged and hash-verified; original Portal prerequisite files unchanged.
- QA / UX_REVIEW: integration_review returned GO. Reviewed code, test reports and all four browser screenshots. Full vendor-body timeout, overall UI deadline, cross-bundle safe errors, and provenance findings resolved. Direct-login scope concern was checked against both success handlers and withdrawn without weakening validation.
- RE_QA: bounded 20s vendor exchange, 45s UI request, aligned URL bounds, 18 Portal frontend tests, 199 resource frontend tests, and clean late-grant-after-logout browser result verified. Default production build restored after loopback test build.
- FINAL_GATE: delivery_gate returned PASS WITH FINDINGS for local development handoff. Documentation count and pending-state findings corrected; no unresolved code blocker. Real vendor/SSO/CSP/Cookie and expanded-root pytest limitations remain disclosed, with live UAT owned by integration owner in the next stage.
- DELIVERY_DECISION: initial local implementation/test handoff complete; no main merge/deployment or production UAT claim. Subsequent user instruction authorizes committing the resource second layer, merging it into `feature/portal-jwt-resource-entry`, and pushing that feature only. Portal changes remain local and uncommitted.
- CLOSE: test browser and four local service groups stopped; ports released. Worker results and QA evidence consolidated in validation.md; all task agents completed, no follow-up implementation pending.

## Acceptance

Positive two-user exchange; direct Portal entry; FineReport legacy entry; forged source/origin/instance; cross-session/stale/nested parent; denied permissions; logout/account change during exchange; vendor errors; cancellation/late responses; no sensitive logging/storage; builds and browser review.

## Run retrospective

- Seven dispatches across six subagents (one planner, three domain workers, QA twice, one final reviewer); root owned Portal frontend, fixtures and browser integration. Peak five actively working agents including root; seven total thread-tree entries.
- Ownership remained disjoint. SDK vendoring waited for its final tests; frontend formal types then replaced the temporary interface. No nested agent dispatch or scope expansion.
- Four substantive review fixes (vendor body deadline, UI overall deadline, cross-bundle safe errors, SDK provenance) were resolved and rechecked. One scope concern was withdrawn after source evidence; no conflict escalation required.
- Root pytest was initially invoked outside the configured backend directory, causing unrelated collection/import-order/WSL failures. Corrected command passed467; extra failures are retained in the validation report. Process lesson: select module cwd/test configuration before invoking repository-wide discovery.
- Two browser-script harness issues were corrected (wait for completed login before API probe; legacy URL removes its consumed query). They did not require application changes; final clean account/isolation/late-response probes passed.
- No global memory/skill changes made. Future real UAT is intentionally separate from this completed local development scope.
