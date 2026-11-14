/** Version comparisons and copy actions use the last submitted snapshot, never
 * the source version's newer working draft. Missing submissions stay unknown. */
export function submittedVersionItems(workspace) {
  const state = workspace?.state || workspace || {};
  return (state.initiatives || []).map((item) => {
    const publication = state.publications?.[String(item.id)]?.at(-1);
    if (!publication?.initiative || item.allocationVisible === false) {
      return { ...item, rows: [], otherBudgets: [], allocationVisible: false, baselineAvailable: false };
    }
    const snapshot = structuredClone(publication.initiative);
    return {
      ...snapshot,
      id: String(snapshot.id || item.id),
      initiativeKey: snapshot.initiativeKey || item.initiativeKey || String(item.id),
      enabled: snapshot.enabled ?? item.enabled,
      allocationVisible: true,
      baselineAvailable: true,
      workflow: { ...snapshot.workflow, ...item.workflow },
      publishedAt: publication.publishedAt,
      publishedRevision: publication.publishedRevision,
    };
  });
}
