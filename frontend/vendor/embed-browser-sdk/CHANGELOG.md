# Changelog

## Unreleased — 2026-11-02

- Optional `HostOptions.dataAgentLaunch` and `EmbedChild.launchDataAgent` vendor bridge,
  isolated from generic JWT launches. Exact message binding, 30-second cancellation,
  bounded concurrency/replay tracking, strict vendor destination checks and safe errors.
- Abort vendor requests on iframe navigation, root/session destruction or child expiry;
  never deliver a late token grant to a navigated or expired instance.

## 0.1.0 — 2026-10-29

- Initial protocol 1.0 host and child ESM entry points with TypeScript declarations.
- Same-origin launch/CSRF flow, form POST iframe navigation, two-level nested requests.
- Bound origin/source/instance/request validation, safe errors, bounded concurrency and cleanup.
- No automatic recovery, production integrations or third-party Cookie compatibility claim.
