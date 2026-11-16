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

// A current-version submission survives draft edits, department withdrawal and
// admin release. A copied source-version baseline is not such a submission.
export function hasCurrentVersionSubmission(initiative) {
  if (initiative?.workflow) return Boolean(initiative.workflow.publicationId);
  return initiative?.publicationId != null;
}

/** @param {Pick<Storage, "getItem"> | undefined} storage */
export function hasReserveAcknowledgement(
  identity,
  version,
  initiative,
  storage = globalThis.sessionStorage,
) {
  if (hasCurrentVersionSubmission(initiative)) return true;
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
