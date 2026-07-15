/**
 * TEMPORARY diagnostic — REMOVE after verifying Groq env config.
 * Reports whether GROQ_API_KEY reaches the Production runtime and what Groq
 * returns when called, WITHOUT ever exposing the key value. GET /api/_diag
 */
export default async function handler(req, res) {
  const groqKey = process.env.GROQ_API_KEY || "";
  const geminiKey = process.env.GEMINI_API_KEY || "";
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  const out = {
    groqKeyPresent: !!groqKey,
    groqKeyLen: groqKey.length, // length only — detects truncation
    groqKeyTrimmedLen: groqKey.trim().length, // mismatch => stray whitespace
    groqKeyPrefixOk: groqKey.startsWith("gsk_"),
    geminiKeyPresent: !!geminiKey,
    model,
    groq: null,
  };

  if (!groqKey) {
    out.groq = { skipped: "GROQ_API_KEY is not present in this runtime" };
    return res.status(200).json(out);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
      signal: controller.signal,
      body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 5 }),
    });
    clearTimeout(timer);
    const text = await r.text();
    let reply = null;
    try {
      reply = JSON.parse(text)?.choices?.[0]?.message?.content ?? null;
    } catch {}
    out.groq = {
      ok: r.ok,
      status: r.status,
      reply,
      // Error detail ONLY on failure (never contains the key).
      body: r.ok ? undefined : text.slice(0, 400),
    };
  } catch (e) {
    out.groq = { ok: false, error: String(e).slice(0, 200) };
  }

  return res.status(200).json(out);
}
