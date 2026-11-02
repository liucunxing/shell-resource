# Vendored Portal browser SDK

Source: `shell-oneportal/packages/embed-browser-sdk`, version 0.1.0, from commit
`599b82b` (2026-11-02 integration checkout). The `src/` files are copied unchanged.
This private source package exports TypeScript so the resource app's existing
Vite/TypeScript build compiles it; it needs no registry publication or sibling
checkout at install time. `package.json` is the resource build adapter, not the
upstream publication manifest. README and CHANGELOG retain upstream documentation.

Update by copying the complete upstream `src/` tree, checking the wire contract,
and running the resource frontend tests/build. Do not edit the protocol locally.
