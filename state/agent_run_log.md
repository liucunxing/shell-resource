# V1.4 Quick Win delivery

- Date: 2026-09-23
- Owner: root
- Mode: Controlled checks, minimal records per user lightweight constraint.
- Baseline: main fast-forward b46ab86 -> 4c44f03; clean before edits.
- Frozen scope and shared interface: docs/quickwin-contract.md; user-approved V1.4.
- Protected: prototype HTML, real remote data, ignored credentials.
- Phase: CONTRACT_FREEZE -> DISPATCH.
- Tickets: BE / FE / AI domain_execution; risk high (permissions/transactions), contract_change yes; root accountable, workers execute, independent QA regression owner, root escalation.
- Evidence target: frontend tests/build, backend service/API integration tests, browser journey, interface/OpenAPI comparison; production access separately reported.
- Database: DNS resolves; TCP 5432 remains unavailable from current host. No remote mutation.
- Near-term worker retention: integration/rework; historical read-only workers have no further task.

## Integration / QA

See completion record below.

## Delivery decision / retrospective

See completion record below. Code completion and live environment readiness are separate claims.

## Integration / QA completed 2026-09-23

- Backend: 58 pytest tests, ruff src/tests/scripts, mypy 64 source files pass.
- Frontend: 39 tests in 11 files, production build pass. ExcelJS lazy chunk size warning retained.
- Independent backend review found and repaired per-user Insight selection, cross-year reference metadata and hardcoded planning-year label. Root reviewed and ran real browser flows; workers were retained for concrete rework.
- Browser: owner draft save/reload, publication isolation, service restart persistence, owner Excel replacement/stale rejection, admin Excel real emails/revision0, owner isolation, lead read-only, management preview and API error recovery verified.
- Single API document covers all 25 actual routes. Local secret config ignored; dynamic credential scan found no leaks in tracked/unignored candidates.
- Evidence: docs/quickwin-validation.md and ignored frontend/output/playwright artifacts.
- Closed local defects: React hooks/initialization, code200 contract, partial save/publish revision, in-flight edits/identity changes, empty dealer picker, audit projection, admin no-op/duplicate handling and real-email Excel.

## Final local decision

Local implementation ready for user review. No remote migration or Git push. PostgreSQL live-schema/transaction acceptance and real Bailian remain unverified. User explicitly deferred application server and asked to use local first. Trusted production identity remains a deployment prerequisite. The local server is isolated synthetic SQLite and optionally reads server-side development AI fields; it does not connect to remote PostgreSQL.

Retrospective: frontend-only green tests did not catch real API field and identity differences. Real browser journeys and service-level transaction tests were necessary; scope and dependencies stayed within the approved Quick Win stack.
