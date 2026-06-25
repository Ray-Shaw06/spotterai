/**
 * SpotterAI — Coach chatbot (front-end)
 * ============================================================================
 * A floating assistant that answers questions about the user's plan and general
 * fitness. Conversation state lives here (no database); each turn POSTs the
 * recent history + the current plan to /api/chat.
 *
 * Imports the shared store so it can attach the latest generated plan as
 * context ("ask about my plan").
 */

import { store } from "./store.js";
import { getContext as getTrackerContext } from "./tracker-store.js";

const fab = document.getElementById("chat-fab");
const panel = document.getElementById("chat-panel");
const closeBtn = document.getElementById("chat-close");
const log = document.getElementById("chat-log");
const form = document.getElementById("chat-form");
const input = document.getElementById("chat-input");
const sendBtn = document.getElementById("chat-send");
const suggestions = document.getElementById("chat-suggestions");
const contextHint = document.getElementById("chat-context");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Real exchanges sent to the API (the greeting below is UI-only).
const messages = [];
let pending = false;

const GREETING =
  "Hey — I'm your SpotterAI coach. Ask me anything about your plan or training in general. I'll keep it practical and safety-first. (I'm educational, not a substitute for a professional.)";

const SUGGESTIONS_NO_PLAN = [
  "How many days a week should a beginner lift?",
  "What's a good warm-up before squats?",
  "Explain RPE in simple terms",
];
const SUGGESTIONS_WITH_PLAN = [
  "Why these rep ranges for my goal?",
  "Swap an exercise I can't do",
  "Is the weekly volume right for me?",
];
const SUGGESTIONS_WITH_TRACKER = [
  "Summarize my week",
  "Am I hitting my protein target?",
  "What should I focus on next week?",
];

// ----------------------------------------------------------------------------
// Tiny, safe markdown-lite renderer (escape first, then limited formatting)
// ----------------------------------------------------------------------------
function escapeHtml(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}

function formatReply(text) {
  const safe = escapeHtml(text);
  const lines = safe.split(/\r?\n/);
  let html = "";
  let inList = false;
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inlineFmt(bullet[1])}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (line.trim()) html += `<p>${inlineFmt(line)}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html || `<p>${inlineFmt(safe)}</p>`;
}

// Bold (**x**) and inline `code`.
function inlineFmt(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

// ----------------------------------------------------------------------------
// Rendering
// ----------------------------------------------------------------------------
function addBubble(role, htmlOrText, { raw = false } = {}) {
  const bubble = document.createElement("div");
  bubble.className = `chat-msg chat-msg--${role}`;
  bubble.innerHTML = raw ? htmlOrText : `<p>${escapeHtml(htmlOrText)}</p>`;
  log.appendChild(bubble);
  scrollToBottom();
  return bubble;
}

function scrollToBottom() {
  log.scrollTo({ top: log.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
}

function showTyping() {
  const t = document.createElement("div");
  t.className = "chat-msg chat-msg--assistant chat-typing";
  t.id = "chat-typing";
  t.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  log.appendChild(t);
  scrollToBottom();
}
function hideTyping() {
  document.getElementById("chat-typing")?.remove();
}

function renderSuggestions() {
  if (!suggestions) return;
  const items = getTrackerContext() ? SUGGESTIONS_WITH_TRACKER : store.plan ? SUGGESTIONS_WITH_PLAN : SUGGESTIONS_NO_PLAN;
  suggestions.innerHTML = items
    .map((s) => `<button type="button" class="chat-suggestion">${escapeHtml(s)}</button>`)
    .join("");
  suggestions.querySelectorAll(".chat-suggestion").forEach((b) =>
    b.addEventListener("click", () => {
      if (pending) return;
      input.value = b.textContent;
      send();
    })
  );
}

function renderContextHint() {
  if (!contextHint) return;
  const bits = [];
  if (store.plan) bits.push(store.plan.program_name || "your plan");
  if (getTrackerContext()) bits.push("your tracker");
  if (bits.length) {
    contextHint.hidden = false;
    contextHint.textContent = `Sees: ${bits.join(" + ")}`;
  } else {
    contextHint.hidden = true;
  }
}

// ----------------------------------------------------------------------------
// Open / close
// ----------------------------------------------------------------------------
let greeted = false;
function openPanel() {
  panel.classList.add("is-open");
  panel.setAttribute("aria-hidden", "false");
  fab.setAttribute("aria-expanded", "true");
  if (!greeted) {
    addBubble("assistant", GREETING);
    greeted = true;
  }
  renderSuggestions();
  renderContextHint();
  setTimeout(() => input.focus(), reducedMotion ? 0 : 250);
}

function closePanel() {
  panel.classList.remove("is-open");
  panel.setAttribute("aria-hidden", "true");
  fab.setAttribute("aria-expanded", "false");
  fab.focus();
}

function togglePanel() {
  panel.classList.contains("is-open") ? closePanel() : openPanel();
}

// ----------------------------------------------------------------------------
// Sending
// ----------------------------------------------------------------------------
async function send() {
  const text = input.value.trim();
  if (!text || pending) return;

  pending = true;
  input.value = "";
  input.style.height = "auto";
  sendBtn.disabled = true;
  if (suggestions) suggestions.hidden = true;

  messages.push({ role: "user", content: text });
  addBubble("user", text);
  showTyping();

  try {
    // The server already retries + falls back to a lighter model; if it still
    // reports an overload (503), wait briefly and try once more from the client.
    let res;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch("api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, plan: store.plan, tracker: getTrackerContext() }),
      });
      if (res.status !== 503) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    hideTyping();

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const msg =
        res.status === 429
          ? "I'm rate-limited right now (free-tier limits). Give it a moment and try again."
          : res.status === 503
          ? "The AI's a bit overloaded at the moment — give it a few seconds and ask again."
          : data.error || "I couldn't reach the coach service just now. Please try again shortly.";
      addBubble("assistant", msg);
    } else {
      const data = await res.json();
      const reply = data.reply || "Sorry, I didn't catch that — could you rephrase?";
      messages.push({ role: "assistant", content: reply });
      addBubble("assistant", formatReply(reply), { raw: true });
    }
  } catch {
    hideTyping();
    addBubble(
      "assistant",
      "I can't reach the coach right now. This feature needs the live API — if you're previewing the static files, generation and chat both require the deployed (or `vercel dev`) backend."
    );
  } finally {
    pending = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

// ----------------------------------------------------------------------------
// Wiring
// ----------------------------------------------------------------------------
if (fab && panel && form && input) {
  fab.addEventListener("click", togglePanel);
  closeBtn?.addEventListener("click", closePanel);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    send();
  });

  // Enter sends; Shift+Enter makes a newline. Auto-grow the textarea.
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("is-open")) closePanel();
  });

  // Keep suggestions/context in sync when a plan is generated or the tracker changes.
  const refresh = () => {
    renderSuggestions();
    renderContextHint();
    if (suggestions) suggestions.hidden = false;
  };
  window.addEventListener("spotter:plan", refresh);
  window.addEventListener("spotter:tracker", refresh);
}
