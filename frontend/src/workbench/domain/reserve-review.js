export function reserveAcknowledgementKey(identity, version, initiativeId) {
  return `ResourceStudio:reserve-review:${identity?.email || identity?.userId || identity?.ownerId || "unknown"}:${identity?.role || ""}:${version || ""}:${initiativeId}`;
}

export function reserveAcknowledgementFingerprint(initiative) {
  return JSON.stringify({
    initiativeId: String(initiative?.id || ""),
    ownerId: initiative?.ownerId || "",
    planningVersionId: initiative?.planningVersionId || "",
    budget: initiative?.budget ?? null,
    reserves: (initiative?.otherBudgets || [])
      .map((row) => ({
        amount: Number(row.amount),
        reasonId: row.reasonId || "",
        note: row.note || "",
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
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
  if (Object.prototype.hasOwnProperty.call(initiative || {}, "editorState"))
    return initiative.editorState?.reserveAcknowledgement === reserveAcknowledgementFingerprint(initiative);
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

export function restoredEditorStep(identity, version, initiative, editable) {
  const step = initiative?.editorState?.step;
  const preferred = [1, 2, 3].includes(step)
    ? step : hasCurrentVersionSubmission(initiative) ? 3 : 1;
  return canEnterAllocationStep(preferred, editable, hasReserveAcknowledgement(identity, version, initiative))
    ? preferred : 1;
}

export function canEnterAllocationStep(step, editable, acknowledged) {
  return step === 1 || !editable || acknowledged;
}
