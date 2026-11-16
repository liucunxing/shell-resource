# Vendored Portal browser SDK

The generic Portal embed protocol 1.0 source originated in
`shell-oneportal-resource-bridge/packages/embed-browser-sdk`, package version
0.1.0. The prior snapshot included the 2026-11-02 vendor extension from
`feature/resource-data-agent-bridge` (base commit `8d2e1b8`); the original
first-layer snapshot was `599b82b`.

On 2026-11-16, the Resource Studio owner explicitly retired the embedded Data
Agent feature. This local copy therefore removes that extension's host/child
bridges, dedicated message schema, types, errors and navigation hooks. The
Portal authentication, generic embed launch/validation, readiness and session
protocol are retained. This is an application-specific subset, not an unchanged
upstream snapshot. Future upstream updates must preserve that retirement.

`SOURCE-SHA256.json` records the six remaining source files, normalized to UTF-8
with LF endings for portable verification. This private package exports
TypeScript for the resource app's Vite/TypeScript build; `package.json` is its
local build adapter. Run the resource frontend tests, build and bundle check
after changing this copy. Portal session coverage includes the real SDK child
readiness/session lifecycle as well as application authentication and CSRF.
