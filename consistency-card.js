/**
 * SpotterAI — consistency card (pure view model + markup)
 * ============================================================================
 * Turns nutrition-streaks.js output into rows and HTML for the Food diary and
 * Today. No DOM access, so the copy can be pinned by a test.
 *
 * TONE IS A REQUIREMENT. Every line says what is counted or what is on offer,
 * never that a day was lost. A run that ends reads "Best 9" and an invitation to
 * pick it up, not a failure state.
 */

const LABELS = Object.freeze({
  protein: "Protein target",
  calories: "Calories in range",
  logged: "Meals logged",
});

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function runText(kind, { current, best }) {
  if (current > 0) return `${plural(current, "day")} in a row`;
  if (best > 0) return "Pick it back up today";
  return kind === "logged" ? "Log a meal to start" : "Hit it today to start";
}

/** Rows for the card, in a fixed order, skipping any streak that is hidden. */
export function streakRows(streaks) {
  if (!streaks) return [];
  return ["protein", "calories", "logged"]
    .filter((kind) => streaks[kind])
    .map((kind) => {
      const s = streaks[kind];
      return {
        kind,
        label: LABELS[kind],
        run: runText(kind, s),
        current: s.current,
        best: s.best,
        last7: s.last7,
        week: s.week,
        meta: s.best > 0 ? `Best ${s.best} · ${s.last7} of last 7 days` : `${s.last7} of last 7 days`,
      };
    });
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** The list of streak rows. `compact` drops the best-run line for the Today card. */
export function streakListHTML(streaks, { compact = false } = {}) {
  const rows = streakRows(streaks);
  if (!rows.length) return "";
  return `<ul class="streaks${compact ? " streaks--compact" : ""}">${rows
    .map(
      (r) => `<li class="streak">
        <div class="streak__text">
          <p class="streak__label">${esc(r.label)}</p>
          <p class="streak__run${r.current > 0 ? " streak__run--on" : ""}">${r.current > 0 ? `<span class="streak__n">${r.current}</span>${esc(r.run.replace(/^\d+/, ""))}` : esc(r.run)}</p>
        </div>
        <span class="streak__week" role="img" aria-label="${esc(r.last7)} of the last 7 days">${r.week
          .map((on) => `<span class="streak__tick${on ? " streak__tick--on" : ""}"></span>`)
          .join("")}</span>
        ${compact ? "" : `<p class="streak__meta">${esc(r.meta)}</p>`}
      </li>`
    )
    .join("")}</ul>`;
}

/** The Food diary card: a real heading, then the rows. Empty string when there is nothing to show. */
export function consistencyCardHTML(streaks) {
  const list = streakListHTML(streaks);
  if (!list) return "";
  return `<h2 class="card-title">Consistency</h2>
    <p class="streaks__lede">Counted from the targets you set and what you log.</p>
    ${list}`;
}
