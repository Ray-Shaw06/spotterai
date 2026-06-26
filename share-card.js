/**
 * SpotterAI — shareable progress card
 * ============================================================================
 * Renders a square PNG of your progress — rank, level, streak, weekly training,
 * and (if you have a plan) its code-audited safety score — to a canvas, then
 * shares it via the Web Share API (with a download fallback). Zero backend.
 */

import { deriveStats } from "./tracker-store.js";
import { evaluatePlan } from "./evaluator.js";
import { store } from "./store.js";

const BG = "#0a0b0d";
const RED = "#ff3b3b";
const W = 1080;
const H = 1080;

function bandColor(score) {
  if (score >= 85) return "#34d399";
  if (score >= 70) return "#fbbf24";
  if (score >= 50) return "#fb923c";
  return RED;
}

function roundRect(x, rx, ry, rw, rh, r) {
  x.beginPath();
  x.moveTo(rx + r, ry);
  x.arcTo(rx + rw, ry, rx + rw, ry + rh, r);
  x.arcTo(rx + rw, ry + rh, rx, ry + rh, r);
  x.arcTo(rx, ry + rh, rx, ry, r);
  x.arcTo(rx, ry, rx + rw, ry, r);
  x.closePath();
}

function ringArc(x, cx, cy, r, pct, color, lw) {
  x.lineWidth = lw;
  x.lineCap = "round";
  x.strokeStyle = "rgba(255,255,255,0.10)";
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.stroke();
  x.strokeStyle = color;
  x.beginPath();
  x.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, pct)));
  x.stroke();
}

function drawCard(stats, score) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d");

  // Background + brand glow + border frame
  x.fillStyle = BG;
  x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W / 2, 360, 40, W / 2, 360, 720);
  glow.addColorStop(0, "rgba(255,59,59,0.16)");
  glow.addColorStop(1, "rgba(255,59,59,0)");
  x.fillStyle = glow;
  x.fillRect(0, 0, W, H);
  x.strokeStyle = "rgba(255,255,255,0.08)";
  x.lineWidth = 2;
  roundRect(x, 40, 40, W - 80, H - 80, 36);
  x.stroke();

  // Wordmark
  x.textAlign = "left";
  x.fillStyle = "#fff";
  x.font = "700 56px 'Space Grotesk', Inter, sans-serif";
  x.fillText("SpotterAI", 96, 158);
  x.fillStyle = RED;
  x.beginPath();
  x.arc(372, 138, 9, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "rgba(255,255,255,0.55)";
  x.font = "400 28px Inter, sans-serif";
  x.fillText("The AI coach that audits its own safety", 96, 204);

  // Central ring — safety score if there's a plan, else rank progress
  const cx = W / 2;
  const cy = 470;
  if (score != null) {
    ringArc(x, cx, cy, 168, score / 100, bandColor(score), 26);
    x.textAlign = "center";
    x.fillStyle = "#fff";
    x.font = "700 130px 'Space Grotesk', Inter, sans-serif";
    x.fillText(String(score), cx, cy + 30);
    x.fillStyle = "rgba(255,255,255,0.5)";
    x.font = "500 30px Inter, sans-serif";
    x.fillText("/ 100 · plan safety", cx, cy + 84);
  } else {
    ringArc(x, cx, cy, 168, stats.rank.progress, stats.rank.tier.color, 26);
    x.textAlign = "center";
    x.fillStyle = "#fff";
    x.font = "700 120px 'Space Grotesk', Inter, sans-serif";
    x.fillText(`L${stats.level}`, cx, cy + 28);
    x.fillStyle = "rgba(255,255,255,0.5)";
    x.font = "500 30px Inter, sans-serif";
    x.fillText(`${stats.totalXP.toLocaleString()} XP`, cx, cy + 84);
  }

  // Rank line
  x.textAlign = "center";
  x.fillStyle = stats.rank.tier.color;
  x.font = "700 56px 'Space Grotesk', Inter, sans-serif";
  x.fillText(stats.rank.tier.name, cx, 740);
  x.fillStyle = "rgba(255,255,255,0.6)";
  x.font = "400 30px Inter, sans-serif";
  x.fillText(`Level ${stats.level} · ${stats.totalXP.toLocaleString()} XP`, cx, 786);

  // Stat tiles
  const tiles = [
    [`${stats.streakDays}`, "day streak"],
    [`${stats.workoutCount}`, "workouts"],
    [`${stats.thisWeek.sessions}/${stats.thisWeek.target}`, "this week"],
    [stats.thisWeek.volume ? `${(stats.thisWeek.volume / 1000).toFixed(1)}k` : "0", "week volume"],
  ];
  const n = tiles.length;
  const tileW = 200;
  const gap = 24;
  const totalW = n * tileW + (n - 1) * gap;
  let tx = (W - totalW) / 2;
  for (const [val, label] of tiles) {
    roundRect(x, tx, 850, tileW, 150, 20);
    x.fillStyle = "rgba(255,255,255,0.04)";
    x.fill();
    x.strokeStyle = "rgba(255,255,255,0.08)";
    x.lineWidth = 1.5;
    x.stroke();
    x.textAlign = "center";
    x.fillStyle = "#fff";
    x.font = "700 50px 'Space Grotesk', Inter, sans-serif";
    x.fillText(val, tx + tileW / 2, 922);
    x.fillStyle = "rgba(255,255,255,0.5)";
    x.font = "400 24px Inter, sans-serif";
    x.fillText(label, tx + tileW / 2, 962);
    tx += tileW + gap;
  }

  // Footer
  x.textAlign = "center";
  x.fillStyle = "rgba(255,255,255,0.35)";
  x.font = "400 24px Inter, sans-serif";
  x.fillText("Audited by a code-based safety evaluator · $0, no backend", cx, 1028);

  return c;
}

export async function shareProgress() {
  try {
    await (document.fonts?.ready || Promise.resolve());
  } catch {
    /* ignore */
  }
  const stats = deriveStats();
  const score = store.plan ? evaluatePlan(store.plan, store.inputs).score : null;
  const canvas = drawCard(stats, score);

  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], "spotterai-progress.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "My SpotterAI progress", text: "My training progress on SpotterAI 💪" });
        return;
      } catch {
        /* user cancelled or share failed → fall back to download */
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "spotterai-progress.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, "image/png");
}

// Wire the dashboard "Share" button (self-contained).
const btn = document.getElementById("share-progress");
btn?.addEventListener("click", shareProgress);
