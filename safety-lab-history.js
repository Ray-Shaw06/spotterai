/**
 * SpotterAI — benchmark history shaping (pure)
 * ============================================================================
 * Turns docs/benchmark-history.json into render rows. Kept out of
 * safety-lab.js so it can be tested under Node, which has no `document`.
 */

/**
 * @param {Array<object>} history oldest first
 * @returns {Array<{version:string,date:string,riskyCaught:number,riskyTotal:number,falsePositives:number,regressed:boolean}>}
 */
export function historyRows(history) {
  if (!Array.isArray(history)) return [];
  return history.map((r, i) => {
    const previous = i > 0 ? history[i - 1] : null;
    return {
      version: r.evaluatorVersion,
      date: r.date,
      riskyCaught: r.riskyCaught,
      riskyTotal: r.riskyTotal,
      falsePositives: r.falsePositives,
      regressed: !!previous && r.riskyCaught < previous.riskyCaught,
    };
  });
}
