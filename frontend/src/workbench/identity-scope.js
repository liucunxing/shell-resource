// Invalidate asynchronous reads when an authorization context is discarded.
let epoch = 0;
export const authorizedReadEpoch = () => epoch;
export const invalidateAuthorizedReads = () => { epoch += 1; };
export function assertAuthorizedRead(expected) {
  if (expected !== epoch)
    throw Object.assign(new Error("授权范围已变化，请重新读取数据。"), { status: 409 });
}
export function identityScopeKey(identity) {
  const list = value => [...new Set(Array.isArray(value) ? value : value ? [value] : [])].sort();
  return JSON.stringify([
    identity?.email, identity?.role, list(identity?.department), list(identity?.sectors),
    identity?.affiliation_sector, identity?.affiliation_department,
    identity?.history_resources == null ? null : list(identity.history_resources),
    identity?.preview || null,
  ]);
}
