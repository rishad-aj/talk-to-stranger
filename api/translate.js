/* Google Translate proxy (no API key needed).
   POST { texts: string[], target: "es" } -> { translations: string[] }
   Also accepts { text, target }. GET ?text=..&target=.. for quick tests. */
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  var texts = [];
  var target = "en";
  try {
    if (req.method === "GET") {
      if (req.query && req.query.text) texts = [String(req.query.text)];
      if (req.query && req.query.target) target = String(req.query.target);
    } else {
      var body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      body = body || {};
      if (Array.isArray(body.texts)) texts = body.texts.map(function (t) { return String(t); });
      else if (body.text != null) texts = [String(body.text)];
      if (body.target) target = String(body.target);
    }
  } catch (e) {}
  target = (target || "en").toLowerCase().slice(0, 8);
  texts = texts.slice(0, 12).map(function (t) { return String(t).slice(0, 2000); });
  if (!texts.length) { res.status(200).json({ translations: [] }); return; }
  async function one(t) {
    if (!t.trim()) return t;
    var u = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" + encodeURIComponent(target) + "&q=" + encodeURIComponent(t);
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!r.ok) throw new Error("gtx " + r.status);
        var j = await r.json();
        var s = "";
        if (j && j[0]) for (var i = 0; i < j[0].length; i++) s += j[0][i][0] || "";
        if (s.trim()) return s;
        throw new Error("empty");
      } catch (e) {
        if (attempt === 2) return t;
        await new Promise(function (res2) { setTimeout(res2, 300 * (attempt + 1)); });
      }
    }
    return t;
  }
  var out = [];
  for (var i = 0; i < texts.length; i++) out.push(await one(texts[i]));
  res.status(200).json({ translations: out });
};
