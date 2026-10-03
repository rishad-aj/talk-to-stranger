/* Google Translate proxy (no API key needed) with MyMemory fallback.
   POST { texts: string[], target: "es" } -> { translations: string[] }
   Also accepts { text, target }. GET ?text=..&target=.. for quick tests.
   Vercel datacenter IPs are often blocked by translate.googleapis.com,
   which used to make this return the input unchanged (client showed
   "Translating..." then nothing). Now: Google first, MyMemory second. */
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
  texts = texts.slice(0, 12).map(function (t) { return String(t).slice(0, 500); });
  if (!texts.length) { res.status(200).json({ translations: [] }); return; }
  var TARGET_MAP = { zh: "zh-CN", fil: "tl", tl: "tl", iw: "he", he: "he", "zh-cn": "zh-CN" };
  function mmTarget(tg) {
    tg = String(tg || "en").toLowerCase();
    if (TARGET_MAP[tg]) return TARGET_MAP[tg];
    return tg.split("-")[0];
  }
  async function viaGoogle(t, tg) {
    if (!t.trim()) return "";
    var u = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" + encodeURIComponent(tg) + "&dt=t&q=" + encodeURIComponent(t);
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        var ctrl = new AbortController();
        var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 6000);
        var r;
        try { r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal }); }
        finally { clearTimeout(timer); }
        if (!r.ok) throw new Error("gtx " + r.status);
        var j = await r.json();
        var s = "";
        if (j && j[0]) for (var i = 0; i < j[0].length; i++) s += j[0][i][0] || "";
        s = String(s || "").trim();
        if (s) return s;
        throw new Error("empty");
      } catch (e) {
        if (attempt === 1) throw e;
        await new Promise(function (res2) { setTimeout(res2, 300); });
      }
    }
    return "";
  }
  async function viaMyMemory(t, tg) {
    if (!t.trim()) return "";
    try {
      var u = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(t.slice(0, 450)) + "&langpair=autodetect%7C" + encodeURIComponent(mmTarget(tg));
      var ctrl = new AbortController();
      var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 7000);
      var r;
      try { r = await fetch(u, { signal: ctrl.signal }); }
      finally { clearTimeout(timer); }
      if (!r.ok) return "";
      var j = await r.json();
      var s = j && j.responseData && String(j.responseData.translatedText || "").trim();
      if (!s) return "";
      if (/invalid|quota|example:/i.test(s) && s.length > 60) return "";
      return s;
    } catch (e) { return ""; }
  }
  async function one(t) {
    if (!t.trim()) return t;
    var g = "";
    try { g = await viaGoogle(t, target); } catch (e) { g = ""; }
    if (g && g.toLowerCase() !== t.trim().toLowerCase()) return g;
    if (g && g.trim()) return g;
    var m = await viaMyMemory(t, target);
    if (m && m.trim()) return m;
    return g || t;
  }
  var out = [];
  for (var i = 0; i < texts.length; i++) {
    out.push(await one(texts[i]));
    if (i < texts.length - 1) await new Promise(function (r) { setTimeout(r, 120); });
  }
  res.status(200).json({ translations: out });
};
