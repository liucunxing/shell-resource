export function reserveAcknowledgementKey(identity, version, initiativeId) {
  return `ResourceStudio:reserve-review:${identity?.email || identity?.userId || identity?.ownerId || "unknown"}:${identity?.role || ""}:${version || ""}:${initiativeId}`;
}

export function reserveAcknowledgementFingerprint(initiative) {
  return JSON.stringify({
    budget: initiative?.budget ?? null,
    reserves: (initiative?.otherBudgets || [])
      .map((row) => ({
        id: row.id || "",
        amount: row.amount,
        reasonId: row.reasonId || "",
        note: row.note || "",
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

/** @param {Pick<Storage, "getItem"> | undefined} storage */
export function hasReserveAcknowledgement(
  identity,
  version,
  initiative,
  storage = globalThis.sessionStorage,
) {
  try {
    return (
      storage?.getItem(
        reserveAcknowledgementKey(identity, version, initiative.id),
      ) === reserveAcknowledgementFingerprint(initiative)
    );
  } catch {
    return false;
  }
}

export function canEnterAllocationStep(step, editable, acknowledged) {
  return step === 1 || !editable || acknowledged;
}
