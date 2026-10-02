export async function googleTranslate(texts, target, source = "auto") {
  const arr = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t ?? ""));
  if (!arr.length) return [];
  const r = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: arr.slice(0, 25), target, source })
  });
  const j = await r.json();
  if (j && Array.isArray(j.translations) && j.translations.length === arr.slice(0, 25).length) return j.translations;
  throw new Error("translate failed");
}
