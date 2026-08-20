/**
 * SpotterAI — production telemetry shaping (pure)
 * ============================================================================
 * Turns the /api/audit-telemetry aggregate into render rows.
 *
 * "Fired" means warn or fail. A pass is the check running and finding nothing,
 * and `not_assessed` is the check declining to run at all, so counting either
 * as a firing would inflate the headline number the page is built to be honest
 * about.
 */

export function productionRows(aggregate) {
  if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) return null;
  const audits = Number(aggregate.audits) || 0;
  if (audits <= 0) return null;

  const byCheck = aggregate.byCheck && typeof aggregate.byCheck === "object" ? aggregate.byCheck : {};
  const rows = Object.entries(byCheck)
    .map(([id, statuses]) => {
      const fired = (statuses?.warn || 0) + (statuses?.fail || 0);
      return { id, fired, rate: Math.round((fired / audits) * 100) };
    })
    .sort((a, b) => b.fired - a.fired || a.id.localeCompare(b.id));

  if (rows.length === 0) return null;
  return { audits, since: aggregate.since || null, rows };
}
