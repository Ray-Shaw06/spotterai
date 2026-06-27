/**
 * SpotterAI — tiny SVG charts (no library, $0)
 * ============================================================================
 * Pure functions that return SVG markup strings: a trend line/area chart, a bar
 * chart, and a progress ring. Used by the dashboard. Charts scale to their
 * container via viewBox; colors accept CSS variables.
 */

function emptyChart(w, h, msg = "No data yet") {
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${msg}">
    <line x1="10" y1="${h - 12}" x2="${w - 10}" y2="${h - 12}" stroke="var(--border)" stroke-width="2" />
    <text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="var(--text-faint)" font-size="13" font-family="Inter, sans-serif">${msg}</text>
  </svg>`;
}

function scale01(v, min, max) {
  if (max === min) return 0.5;
  return (v - min) / (max - min);
}

/** Line + area trend chart. `series` = [{ label, value }]. */
export function lineChart(series, { color = "var(--accent)", height = 120, pad = 12, area = true, dots = true } = {}) {
  const w = 320, h = height;
  if (!series || !series.length) return emptyChart(w, h);
  const vals = series.map((p) => p.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const n = series.length;
  const x = (i) => pad + (n === 1 ? 0.5 : i / (n - 1)) * (w - 2 * pad);
  const y = (v) => h - pad - scale01(v, min, max) * (h - 2 * pad);
  const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const areaPts = `${x(0).toFixed(1)},${(h - pad).toFixed(1)} ${pts} ${x(n - 1).toFixed(1)},${(h - pad).toFixed(1)}`;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="trend chart">
    ${area ? `<polygon points="${areaPts}" fill="${color}" opacity="0.12" />` : ""}
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
    ${dots ? series.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="2.6" fill="${color}" />`).join("") : ""}
  </svg>`;
}

/** Vertical bar chart. `series` = [{ label, value }]. */
export function barChart(series, { color = "var(--accent)", height = 120, pad = 12, gap = 6 } = {}) {
  const w = 320, h = height;
  if (!series || !series.length || series.every((p) => !p.value)) return emptyChart(w, h);
  const max = Math.max(...series.map((p) => p.value), 1);
  const n = series.length;
  const bw = (w - 2 * pad - gap * (n - 1)) / n;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="bar chart">
    ${series
      .map((p, i) => {
        const bh = (p.value / max) * (h - 2 * pad);
        const x = pad + i * (bw + gap);
        const yy = h - pad - bh;
        return `<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2, bh).toFixed(1)}" rx="3" fill="${color}" opacity="${p.value ? 0.85 : 0.22}" />`;
      })
      .join("")}
  </svg>`;
}

/** Progress ring. Returns SVG only; overlay text in the DOM. */
export function ring(value, max, { size = 120, color = "var(--accent)", stroke = 10 } = {}) {
  const r = (size - stroke) / 2 - 1;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  const off = c * (1 - pct);
  const cx = size / 2, cy = size / 2;
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" role="img" aria-label="${Math.round(pct * 100)}%">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${stroke}" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"
      style="transition: stroke-dashoffset 600ms cubic-bezier(.22,1,.36,1)" />
  </svg>`;
}
