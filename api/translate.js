export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const target = String((body && body.target) || "en").slice(0, 8);
  const source = String((body && body.source) || "auto").slice(0, 8);
  let texts = body && body.texts ? body.texts : (body && body.text ? [body.text] : []);
  texts = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t ?? "")).slice(0, 25);
  if (!texts.length) return res.status(400).json({ error: "no text" });
  const key = process.env.GOOGLE_TRANSLATE_API_KEY;
  try {
    if (key) {
      const r = await fetch("https://translation.googleapis.com/language/translate/v2?key=" + encodeURIComponent(key), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: texts, target, source_language: source === "auto" ? undefined : source, format: "text" })
      });
      const j = await r.json();
      const out = (j && j.data && j.data.translations || []).map((t) => t.translatedText);
      if (out.length === texts.length) return res.status(200).json({ translations: out, engine: "google-official" });
    }
    const out = [];
    for (const t of texts) {
      const u = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=" + encodeURIComponent(source) + "&tl=" + encodeURIComponent(target) + "&dt=t&q=" + encodeURIComponent(t);
      const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } });
      const j = await r.json();
      out.push(Array.isArray(j) && Array.isArray(j[0]) ? j[0].map((s) => s[0] ?? "").join("") : t);
    }
    return res.status(200).json({ translations: out, engine: "google-free" });
  } catch (e) {
    return res.status(500).json({ error: "translate failed" });
  }
}
