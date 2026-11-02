# Vendored Portal browser SDK

Source: `shell-oneportal-resource-bridge/packages/embed-browser-sdk`, package
version 0.1.0 plus the 2026-11-02 Unreleased vendor-bridge changes on
`feature/resource-data-agent-bridge` (base commit `8d2e1b8`). This working-tree
snapshot is not yet committed upstream. All nine `src/` files were copied
unchanged and byte-for-byte checked against that feature worktree. Their SHA256
manifest is `SOURCE-SHA256.json` (UTF-8 source with LF line endings, matching Git
blobs so it is portable across Windows/Linux); update provenance to the final upstream commit
when the paired feature is committed. The prior first-layer snapshot was `599b82b`.
This private source package exports TypeScript so the resource app's existing
Vite/TypeScript build compiles it; it needs no registry publication or sibling
checkout at install time. `package.json` is the resource build adapter, not the
upstream publication manifest. README and CHANGELOG retain upstream documentation.

Update by copying the complete upstream `src/` tree, checking the wire contract,
and running the resource frontend tests/build. Do not edit the protocol locally.
