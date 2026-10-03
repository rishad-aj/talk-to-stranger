/* Chat Room - Vercel/Supabase compatibility shim.
   Provides the same `window.root` API the UI code was written against:
   root.profanity / root.kv / root.superFetch / root.uploadPlugin / root.ai / root.createServerSocket
   Realtime transport: Supabase Realtime (broadcast + presence).
   History/media: the app's own Supabase mirror (messages table) - unchanged.
   Translation: Google Translate via /api/translate (no key needed). */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
window.generatorName = window.generatorName || "chat";
(function () {
"use strict";
var DEF_URL = "https://yvqndfyiwkegxkeolvoh.supabase.co";
var DEF_KEY = "sb_publishable_AVPKoEterodpUPjlLCn3RA_d6q3ZJNn";
var CFG = { url: DEF_URL, key: DEF_KEY };
try {
  if (window.__SUPABASE_URL) CFG.url = window.__SUPABASE_URL;
  if (window.__SUPABASE_ANON_KEY) CFG.key = window.__SUPABASE_ANON_KEY;
} catch (e) {}
var configReady = new Promise(function (res) {
  var done = false;
  function fin() { if (!done) { done = true; res(true); } }
  fetch("./api/config").then(function (r) { return r.json(); }).then(function (j) {
    if (j && j.url && j.key) { CFG.url = j.url; CFG.key = j.key; }
    fin();
  }).catch(fin);
  setTimeout(fin, 2500);
});
function sbH() {
  return { apikey: CFG.key, Authorization: "Bearer " + CFG.key, "Content-Type": "application/json", Prefer: "return=minimal" };
}
function rest(path, method, body) {
  var opt = { method: method || "GET", headers: sbH() };
  if (body !== undefined) opt.body = JSON.stringify(body);
  return fetch(CFG.url + "/rest/v1/" + path, opt);
}
function restJson(path) {
  return rest(path, "GET").then(function (r) { return r.json(); }).catch(function () { return null; });
}
var _sb = null;
function sbClient() {
  if (_sb) return _sb;
  _sb = createClient(CFG.url, CFG.key);
  return _sb;
}
function sha256Hex(s) {
  var buf = new TextEncoder().encode(s);
  return crypto.subtle.digest("SHA-256", buf).then(function (d) {
    var h = "", b = new Uint8Array(d);
    for (var i = 0; i < b.length; i++) h += b[i].toString(16).padStart(2, "0");
    return h;
  });
}
function hashPass(pass, salt) { return sha256Hex(salt + "\0" + pass); }
var ADMIN_NAME = "admin";
var PROTECTED = [
  { name: "Anya", salt: "482212aa9240f0dcee8d4692e653fbf5", hash: "880ea8a131d2589e50f65ac7752481159ae837ec904edeb6dc3cb506e97d89a3" },
  { name: "Jonathan", salt: "8deed5a1a0fe04392742b7c36af5b757", hash: "cf5893331e6c67509878f31618428a0058eab189cc23075c5e8672c280d71a19" }
];
function protectedUser(name) {
  var ln = String(name || "").toLowerCase();
  for (var i = 0; i < PROTECTED.length; i++) if (PROTECTED[i].name.toLowerCase() === ln) return PROTECTED[i];
  return null;
}
function hasEmoji(s) {
  return /(?:\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDC00-\uDFFF]|[\u00A9\u00AE\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23E9-\u23F3\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB-\u25FE\u2600-\u27BF\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299\uFE0F\u200D\u20E3])/.test(s || "");
}
function nameValid(n) { return !!n && Array.from(n).length >= 4 && !hasEmoji(n); }
var PROF = [];
fetch("./profanity.json").then(function (r) { return r.json(); }).then(function (a) { if (Array.isArray(a)) PROF = a; }).catch(function () {});
function normName(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(.)\1+/g, "$1"); }
function nameHasBlacklisted(name) {
  var n = normName(name);
  if (!n) return false;
  for (var i = 0; i < PROF.length; i++) {
    var w = String(PROF[i]).toLowerCase();
    if (w.length < 4) { if (n === w) return true; continue; }
    if (n.indexOf(w) !== -1) return true;
  }
  return false;
}
function isEmoji(s) {
  if (typeof s !== "string" || !s) return false;
  var cps = [], i, ch;
  for (var ch of s) cps.push(ch.codePointAt(0));
  if (cps.length > 12) return false;
  var pict = 0;
  for (i = 0; i < cps.length; i++) {
    var c = cps[i];
    if (c >= 0x1F000 && c <= 0x1FAFF) { pict++; continue; }
    if (c >= 0x2600 && c <= 0x27BF) { pict++; continue; }
    if (c >= 0x2B00 && c <= 0x2BFF) { pict++; continue; }
    if (c >= 0x2190 && c <= 0x21FF) continue;
    if (c >= 0x2300 && c <= 0x23FF) continue;
    if (c >= 0x2900 && c <= 0x297F) continue;
    if (c >= 0x3030 && c <= 0x303D) continue;
    if (c === 0x00A9 || c === 0x00AE || c === 0x2122 || c === 0x2139 ||
        c === 0x203C || c === 0x2049 || c === 0x25AA || c === 0x25AB ||
        c === 0x25B6 || c === 0x25C0 || c === 0x25FB || c === 0x25FC ||
        c === 0x25FD || c === 0x25FE || c === 0x2B05 || c === 0x2B06 ||
        c === 0x2B07 || c === 0x2B1B || c === 0x2B1C || c === 0x2B50 ||
        c === 0x2B55 || c === 0x2934 || c === 0x2935) continue;
    if (c === 0x200D || c === 0x20E3) continue;
    if (c >= 0xFE00 && c <= 0xFE0F) { if (c === 0xFE0F) pict++; continue; }
    if (c >= 0xE0020 && c <= 0xE007F) continue;
    if (c === 0x23 || c === 0x2A || (c >= 0x30 && c <= 0x39)) continue;
    return false;
  }
  return pict > 0;
}
function metaGet(key, fb) {
  return restJson("room_meta?select=value&key=eq." + encodeURIComponent(key)).then(function (r) {
    if (Array.isArray(r) && r.length && r[0] && r[0].value !== undefined) return r[0].value;
    return fb;
  });
}
function metaSet(key, value) {
  return rest("room_meta", "POST", { key: key, value: value }).then(function (r) {
    if (r.ok) return true;
    return rest("room_meta?key=eq." + encodeURIComponent(key), "PATCH", { value: value }).then(function (r2) { return r2.ok; }).catch(function () { return false; });
  }).catch(function () { return false; });
}
function mapRowToMsg(row) {
  var base = { id: "sb-" + row.id, from: row.sender, ts: Number(row.ts) || 0, flagged: !!row.flagged };
  if (row.reply_to && !/^\s*\{/.test(String(row.reply_to))) base.replyTo = { id: String(row.reply_to) };
  else if (row.reply_to) { try { var rp = JSON.parse(row.reply_to); if (rp && rp.id) base.replyTo = { id: String(rp.id) }; } catch (e) {} }
  if (row.type === "delnote") {
    var out = { t: "delnote", id: base.id, from: base.from, ts: base.ts };
    if (row.text && String(row.text).indexOf("__deln__") === 0) {
      try {
        var p = JSON.parse(String(row.text).slice(8));
        if (p && typeof p === "object" && ("o" in p || "b" in p)) { if (p.o) out.orig = p.o; if (p.b) out.by = String(p.b); }
        else if (p) out.orig = p;
      } catch (e) {}
    }
    return out;
  }
  if (row.type === "chat") { base.t = "chat"; base.text = row.text || ""; return base; }
  if (row.type === "img") { base.t = "img"; base.url = row.url || ""; if (row.text) base.caption = row.text; return base; }
  if (row.type === "voice") { base.t = "voice"; base.url = row.url || ""; base.dur = row.dur || 0; base.size = row.size || 0; return base; }
  return null;
}
function historyQuery(limit) {
  return restJson("messages?select=id,ts,sender,type,text,url,dur,size,reply_to,flagged&type=not.like.dm.*&order=ts.desc&limit=" + (limit || 100)).then(function (rows) {
    if (!Array.isArray(rows)) return [];
    rows.reverse();
    var out = [];
    for (var i = 0; i < rows.length; i++) { var m = mapRowToMsg(rows[i]); if (m) out.push(m); }
    return out;
  });
}
function dmRowToMsg(row) {
  var meta = {};
  try { meta = JSON.parse(row.reply_to || "{}"); } catch (e) {}
  var kind = meta.s === "img" || meta.s === "voice" ? meta.s : "chat";
  var m = { t: kind, from: row.sender, ts: Number(row.ts) || 0, sb: true, id: meta.id ? "sb-" + meta.id : "sb-dm-" + row.id };
  if (meta.rp) m.replyTo = meta.rp;
  if (kind === "chat") m.text = row.text || "";
  else if (kind === "img") { m.url = row.url || ""; if (row.text) m.caption = row.text; }
  else { m.url = row.url || ""; m.dur = row.dur || 0; m.size = row.size || 0; }
  return { msg: m, meta: meta };
}
function dmRowsAll() {
  return restJson("messages?select=id,ts,sender,type,text,url,dur,size,reply_to&type=like.dm.*&order=ts.desc&limit=2000").then(function (r) { return Array.isArray(r) ? r : []; });
}
var LANG_CODE = { english: "en", spanish: "es", french: "fr", german: "de", portuguese: "pt", italian: "it", russian: "ru", ukrainian: "uk", polish: "pl", dutch: "nl", turkish: "tr", arabic: "ar", hindi: "hi", bengali: "bn", urdu: "ur", chinese: "zh", japanese: "ja", korean: "ko", vietnamese: "vi", thai: "th", indonesian: "id", malay: "ms", filipino: "fil", swahili: "sw", malayalam: "ml", tamil: "ta" };
function targetOfInstruction(ins) {
  var m = String(ins || "").match(/Translate every message into ([A-Za-z ()/-]+)\./);
  if (m) {
    var n = m[1].trim().toLowerCase();
    if (LANG_CODE[n]) return LANG_CODE[n];
    for (var k in LANG_CODE) if (k.indexOf(n) === 0 || n.indexOf(k) === 0) return LANG_CODE[k];
  }
  return "en";
}
function parseBatch(ins) {
  var m = String(ins || "").match(/BATCH MODE: Translate all (\d+)/);
  var n = m ? parseInt(m[1], 10) : 0;
  var parts = String(ins || "").split("Messages to translate:");
  var list = [];
  if (parts.length > 1 && n > 0) {
    var lines = parts[parts.length - 1].split("\n");
    for (var i = 0; i < lines.length && list.length < n; i++) {
      var lm = lines[i].match(/^\s*\d+[.)]\s*(.*)$/);
      if (lm) list.push(lm[1]);
    }
  }
  return { n: n, list: list };
}
function googleDirect(texts, target) {
  var jobs = texts.map(function (t) {
    var u = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" + encodeURIComponent(target) + "&q=" + encodeURIComponent(t);
    return fetch(u).then(function (r) { return r.json(); }).then(function (j) {
      var s = "";
      if (j && j[0]) for (var i = 0; i < j[0].length; i++) s += j[0][i][0] || "";
      return s || t;
    }).catch(function () { return t; });
  });
  return Promise.all(jobs);
}
function aiTranslate(opts) {
  var ins = (opts && opts.instruction) || "";
  var target = targetOfInstruction(ins);
  var b = parseBatch(ins);
  var texts, batch;
  if (b.n > 0 && b.list.length) { texts = b.list; batch = true; }
  else {
    var sp = String(ins).split("Translate this:");
    texts = [sp.length > 1 ? sp[sp.length - 1].trim() : String(ins).trim()];
    batch = false;
  }
  function done(arr) {
    if (batch) {
      var lines = arr.map(function (t, i) { return (i + 1) + ". " + t; });
      return { text: lines.join("\n") };
    }
    return { text: arr[0] || texts[0] };
  }
  return fetch("./api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: texts, target: target })
  }).then(function (r) { return r.json(); }).then(function (j) {
    if (j && Array.isArray(j.translations) && j.translations.length) return done(j.translations);
    return googleDirect(texts, target).then(done);
  }).catch(function () { return googleDirect(texts, target).then(done); });
}
function kvStore(prefix) {
  return {
    get: function (k) { return Promise.resolve().then(function () { try { var v = localStorage.getItem("kv:" + prefix + ":" + k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } }); },
    set: function (k, v) { return Promise.resolve().then(function () { try { localStorage.setItem("kv:" + prefix + ":" + k, JSON.stringify(v)); } catch (e) {} return true; }); },
    delete: function (k) { return Promise.resolve().then(function () { try { localStorage.removeItem("kv:" + prefix + ":" + k); } catch (e) {} return true; }); }
  };
}
function uploadBlob(blob) {
  var ext = "bin";
  var t = (blob && blob.type) || "";
  if (t.indexOf("jpeg") !== -1 || t.indexOf("jpg") !== -1) ext = "jpg";
  else if (t.indexOf("png") !== -1) ext = "png";
  else if (t.indexOf("gif") !== -1) ext = "gif";
  else if (t.indexOf("webp") !== -1) ext = "webp";
  else if (t.indexOf("ogg") !== -1 || t.indexOf("opus") !== -1) ext = "ogg";
  else if (t.indexOf("webm") !== -1) ext = "webm";
  else if (t.indexOf("mp4") !== -1 || t.indexOf("m4a") !== -1 || t.indexOf("aac") !== -1) ext = "m4a";
  var name = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10) + "." + ext;
  var headers = { apikey: CFG.key, Authorization: "Bearer " + CFG.key, "Content-Type": t || "application/octet-stream", "x-upsert": "true" };
  return fetch(CFG.url + "/storage/v1/object/chat-media/" + name, { method: "POST", headers: headers, body: blob }).then(function (r) {
    if (!r.ok) throw new Error("upload " + r.status);
    return { url: CFG.url + "/storage/v1/object/public/chat-media/" + name, error: null };
  }).catch(function (e) { return { url: "", error: String((e && e.message) || e) }; });
}
function randName() { return "Guest" + Math.floor(1000 + Math.random() * 9000); }
function SupaSocket() {
  var self = this;
  self._et = new EventTarget();
  self.readyState = 0;
  self._reconnectDone = false;
  self._myName = null;
  self._myUid = "";
  self._named = false;
  self._openResolve = null;
  self._openReject = null;
  self.opened = new Promise(function (res, rej) { self._openResolve = res; self._openReject = rej; });
  self._inbox = null;
  self._inboxName = null;
  self._room = null;
  self._rxCache = null;
  self._init();
}
SupaSocket.prototype.addEventListener = function (t, l, o) { return this._et.addEventListener(t, l, o); };
SupaSocket.prototype.removeEventListener = function (t, l, o) { return this._et.removeEventListener(t, l, o); };
SupaSocket.prototype.dispatchEvent = function (e) { return this._et.dispatchEvent(e); };
SupaSocket.prototype._emit = function (obj) {
  var ev;
  try { ev = new MessageEvent("message", { data: JSON.stringify(obj) }); }
  catch (e) { ev = new Event("message"); ev.data = JSON.stringify(obj); }
  this.dispatchEvent(ev);
};
SupaSocket.prototype._fail = function (err) {
  this.readyState = 3;
  if (this._openReject) this._openReject(err);
  var ev = new Event("close"); ev.code = 1006;
  this.dispatchEvent(ev);
};
SupaSocket.prototype._init = function () {
  var self = this;
  configReady.then(function () {
  var chan;
  try {
    chan = sbClient().channel("chat-room-v1", { config: { broadcast: { self: true }, presence: { key: "sock-" + Math.random().toString(36).slice(2) } } });
  } catch (e) { self._fail(e); return; }
  self._room = chan;
  chan.on("broadcast", { event: "msg" }, function (p) { if (p && p.payload) self._emit(p.payload); });
  chan.on("presence", { event: "sync" }, function () { self._presence(); });
  chan.subscribe(function (status) {
    if (status === "SUBSCRIBED") {
      self.readyState = 1;
      window.__sockState = 1;
      var g = randName();
      self._myName = g;
      chan.track({ name: g, uid: "", named: false }).then(function () {
        if (self._openResolve) self._openResolve(true);
        self.dispatchEvent(new Event("open"));
        self._emit({ t: "me", name: g });
        self._presence();
      }).catch(function () {
        if (self._openResolve) self._openResolve(true);
        self.dispatchEvent(new Event("open"));
        self._emit({ t: "me", name: g });
      });
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      if (self.readyState === 0) self._fail(new Error(status));
      else { self.readyState = 3; var ev = new Event("close"); ev.code = 1006; self.dispatchEvent(ev); }
    }
  });
  });
};
SupaSocket.prototype._presenceNames = function () {
  var out = [], seen = {};
  try {
    var st = this._room.presenceState();
    for (var k in st) {
      var arr = st[k] || [];
      for (var i = 0; i < arr.length; i++) {
        var n = arr[i] && arr[i].name;
        if (n && arr[i].named !== false && !seen[n]) { seen[n] = 1; out.push({ name: n, uid: arr[i].uid || "" }); }
      }
    }
  } catch (e) {}
  return out;
};
SupaSocket.prototype._presence = function () {
  var self = this;
  metaGet("fake", []).then(function (fake) {
    var names = self._presenceNames();
    var count = names.length + (Array.isArray(fake) ? fake.length : 0);
    self._emit({ t: "presence", count: count });
  }).catch(function () {
    self._emit({ t: "presence", count: self._presenceNames().length });
  });
};
SupaSocket.prototype._broad = function (obj) {
  var self = this;
  return self._room.send({ type: "broadcast", event: "msg", payload: obj }).catch(function () {});
};
SupaSocket.prototype._inboxSend = function (name, obj) {
  var ch = sbClient().channel("tmp-send-" + Math.random().toString(36).slice(2));
  var self = this;
  return new Promise(function (res) {
    var to;
    try {
      to = setTimeout(function () { try { sbClient().removeChannel(ch); } catch (e) {} res(false); }, 6000);
      ch.subscribe(function (s) {
        if (s === "SUBSCRIBED") {
          clearTimeout(to);
          ch.send({ type: "broadcast", event: "dm", payload: obj, to: name }).then(function () {
            try { sbClient().removeChannel(ch); } catch (e) {}
            res(true);
          }).catch(function () { try { sbClient().removeChannel(ch); } catch (e) {} res(false); });
        }
      });
    } catch (e) { res(false); }
  });
};
SupaSocket.prototype._ensureInbox = function (name) {
  var self = this;
  if (self._inbox && self._inboxName === name) return Promise.resolve();
  if (self._inbox) { try { sbClient().removeChannel(self._inbox); } catch (e) {} self._inbox = null; }
  self._inboxName = name;
  var ch = sbClient().channel("inbox-" + String(name).toLowerCase(), { config: { broadcast: { self: true } } });
  self._inbox = ch;
  ch.on("broadcast", { event: "dm" }, function (p) { if (p && p.payload) self._emit(p.payload); });
  return new Promise(function (res) { ch.subscribe(function () { res(true); }); setTimeout(function () { res(true); }, 4000); });
};
SupaSocket.prototype.close = function () {
  try { if (this._room) sbClient().removeChannel(this._room); } catch (e) {}
  try { if (this._inbox) sbClient().removeChannel(this._inbox); } catch (e) {}
  this.readyState = 3;
  window.__sockState = 3;
  if (!this._reconnectDone) { var ev = new Event("close"); ev.code = 1000; this.dispatchEvent(ev); }
};
SupaSocket.prototype.send = function (str) {
  var self = this;
  var m;
  try { m = JSON.parse(str); } catch (e) { return; }
  if (!m || typeof m.t !== "string") return;
  var now = Date.now();
  if (m.t === "chat" || m.t === "img" || m.t === "voice") {
    var text = String(m.text || "").trim().slice(0, 500);
    if (m.t === "chat" && !text) return;
    if ((m.t === "img" || m.t === "voice") && String(m.url || "").indexOf("https://") !== 0) return;
    var msg = { t: m.t, from: self._myName, id: now + "-" + Math.floor(Math.random() * 1000), ts: Number(m.ts) || now };
    if (self._myUid) msg.uid = self._myUid;
    if (m.t === "chat") msg.text = text;
    else {
      msg.url = String(m.url).slice(0, 500);
      if (m.t === "img" && m.caption) msg.caption = String(m.caption).slice(0, 500);
      if (m.t === "voice") { msg.dur = Number(m.dur) || 0; msg.size = Number(m.size) || 0; }
    }
    if (m.replyTo && typeof m.replyTo === "object") msg.replyTo = m.replyTo;
    self._broad(msg);
  } else if (m.t === "edit") {
    self._broad({ t: "edit", id: String(m.id || ""), text: String(m.text || "").slice(0, 500), from: m.from || self._myName, mts: m.ts != null ? Number(m.ts) : null, ts: now });
  } else if (m.t === "del") {
    var silent = m.silent === true;
    if (!silent) {
      self._broad({ t: "delnote", id: String(m.id || ""), from: m.from || null, mts: m.ts != null ? Number(m.ts) : null, ts: now, orig: (m.snap && typeof m.snap === "object") ? m.snap : null, by: self._myName });
    } else {
      self._broad({ t: "del", id: String(m.id || ""), from: m.from || null, mts: m.ts != null ? Number(m.ts) : null, ts: now });
    }
  } else if (m.t === "react") {
    self._toggleRx(m.from || null, m.ts != null ? Number(m.ts) : null, String(m.emoji || ""), m.id || null);
  } else if (m.t === "flag") {
    self._broad({ t: "flag", id: String(m.id || ""), flagged: !!m.to, from: m.from || null, mts: m.ts != null ? Number(m.ts) : null, ts: now });
  } else if (m.t === "typing") {
    self._broad({ t: "typing", from: self._myName, uid: self._myUid || "" });
  } else if (m.t === "sysmsg") {
    if (self._myName !== ADMIN_NAME) return;
    var txt = String(m.text || "").trim().slice(0, 100);
    metaGet("fake", []).then(function (fake) {
      fake = Array.isArray(fake) ? fake : [];
      var nm = txt.replace(/\s+(joined|left)$/, "").trim();
      if (m.presence === "join") { if (nm && fake.indexOf(nm) === -1) fake.push(nm); }
      else if (m.presence === "left") { fake = fake.filter(function (x) { return x !== nm; }); }
      metaSet("fake", fake).then(function () {
        self._broad({ t: "system", text: txt, ts: now });
        self._presence();
      });
    });
  } else if (m.t === "dm") {
    self._dmSend(m);
  }
};
SupaSocket.prototype._rxKey = function (from, ts) { return String(from) + "|" + String(Number(ts) || 0); };
SupaSocket.prototype._toggleRx = function (from, ts, emoji, id) {
  var self = this;
  if (!from || ts == null || !isEmoji(emoji)) return Promise.resolve();
  var who = self._myUid ? "u:" + self._myUid : "n:" + self._myName;
  return metaGet("rx", {}).then(function (store) {
    store = (store && typeof store === "object") ? store : {};
    var key = self._rxKey(from, ts);
    var e = store[key] || { f: String(from).slice(0, 20), t: Number(ts) || 0, rx: {} };
    var prev = (e.rx && typeof e.rx === "object") ? e.rx : {};
    var next = {}, k;
    for (k in prev) { if (k === emoji || !prev[k] || !prev[k].length) continue; next[k] = prev[k].slice(0, 120); }
    var list = prev[emoji] ? prev[emoji].filter(function (x) { return x !== who; }) : [];
    if (list.length === (prev[emoji] || []).length && list.length < 120) list.push(who);
    if (list.length) next[emoji] = list;
    if (Object.keys(next).length) store[key] = { f: e.f, t: e.t, rx: next };
    else delete store[key];
    var names = {};
    return metaGet("rxnames", {}).then(function (nm) {
      nm = (nm && typeof nm === "object") ? nm : {};
      nm[who] = self._myName;
      for (var em in next) for (var i = 0; i < next[em].length; i++) if (nm[next[em][i]]) names[next[em][i]] = nm[next[em][i]];
      return metaSet("rxnames", nm).then(function () { return metaSet("rx", store); }).then(function () {
        self._broad({ t: "react", id: id, from: from, mts: ts, rx: next, nm: names, ts: Date.now() });
      });
    });
  }).catch(function () {});
};
SupaSocket.prototype._dmPairKey = function (a, b) {
  var x = a < b ? a : b, y = a < b ? b : a;
  return sha256Hex(x + "\0" + y).then(function (h) { return "dm." + h.slice(0, 32); });
};
SupaSocket.prototype._dmSend = function (m) {
  var self = this;
  var to = String(m.to || "").trim().slice(0, 20);
  if (!to || to === self._myName) return;
  var now = Date.now();
  if (m.ev === "read") {
    self._inboxSend(to, { t: "dm", peer: self._myName, ev: "read", ts: now });
    return;
  }
  if (m.ev === "typing") {
    self._inboxSend(to, { t: "dm", peer: self._myName, ev: "typing" });
    return;
  }
  if (m.ev === "del" || m.ev === "delete") {
    var p = { t: "dm", peer: self._myName, ev: "del", id: String(m.id || ""), from: self._myName, ts: now };
    self._inboxSend(to, p);
    self._inboxSend(self._myName, { t: "dm", peer: to, ev: "del", id: String(m.id || ""), from: self._myName, ts: now });
    return;
  }
  if (m.ev === "edit") {
    var pe = { t: "dm", peer: self._myName, ev: "edit", id: String(m.id || ""), from: self._myName, text: String(m.text || "").slice(0, 500), ts: now };
    self._inboxSend(to, pe);
    self._inboxSend(self._myName, { t: "dm", peer: to, ev: "edit", id: String(m.id || ""), from: self._myName, text: String(m.text || "").slice(0, 500), ts: now });
    return;
  }
  if (m.ev === "react") {
    self._toggleRx(m.from || null, m.ts != null ? Number(m.ts) : (m.mts != null ? Number(m.mts) : null), String(m.emoji || ""), m.id || null).then(function () {});
    return;
  }
  if (m.ev) return;
  var sub = m.sub === "img" || m.sub === "voice" ? m.sub : "chat";
  var msg = { t: "dm", sub: sub, from: self._myName, ts: Number(m.ts) || now, id: "d" + now + "-" + Math.floor(Math.random() * 1000) };
  if (self._myUid) msg.uid = self._myUid;
  if (sub === "chat") {
    msg.text = String(m.text || "").trim().slice(0, 500);
    if (!msg.text) return;
  } else {
    if (String(m.url || "").indexOf("https://") !== 0) return;
    msg.url = String(m.url).slice(0, 500);
    if (sub === "img" && m.caption) msg.caption = String(m.caption).slice(0, 500);
    if (sub === "voice") { msg.dur = Number(m.dur) || 0; msg.size = Number(m.size) || 0; }
  }
  if (m.replyTo && typeof m.replyTo === "object") msg.replyTo = m.replyTo;
  var a = Object.assign({}, msg, { peer: self._myName });
  var b = Object.assign({}, msg, { peer: to });
  self._inboxSend(to, a);
  if (to !== self._myName) self._inboxSend(self._myName, b);
};
function isVerifiedName(n, verified) { return Array.isArray(verified) && verified.indexOf(n) !== -1; }
SupaSocket.prototype.rpc = {};
SupaSocket.prototype.rpc.reportLoc = function () { return Promise.resolve("ok"); };
SupaSocket.prototype.rpc.getHistory = function () {
  return historyQuery(100).then(function (rows) { return JSON.stringify(rows); });
};
SupaSocket.prototype.rpc.getBanned = function () {
  return metaGet("bans", []).then(function (b) { return JSON.stringify((Array.isArray(b) ? b : []).map(function (x) { return x.name; })); });
};
SupaSocket.prototype.rpc.getReactions = function () {
  return Promise.all([metaGet("rx", {}), metaGet("rxnames", {})]).then(function (r) {
    var store = r[0] || {}, nm = r[1] || {}, out = [];
    for (var k in store) {
      var e = store[k];
      if (e && e.rx && Object.keys(e.rx).length) {
        var names = {};
        for (var em in e.rx) for (var i = 0; i < e.rx[em].length; i++) if (nm[e.rx[em][i]]) names[e.rx[em][i]] = nm[e.rx[em][i]];
        out.push({ from: e.f, ts: e.t, rx: e.rx, nm: names });
      }
    }
    return JSON.stringify(out);
  });
};
SupaSocket.prototype.rpc.getTitle = function () {
  return metaGet("title", "").then(function (t) { return String(t || ""); });
};
SupaSocket.prototype.rpc.setTitle = function (data) {
  var self = this;
  if (self._myName !== ADMIN_NAME) return Promise.resolve("admin only");
  var t = String(data || "").trim().slice(0, 60);
  if (!t) return Promise.resolve("invalid");
  return metaSet("title", t).then(function () { self._broad({ t: "title", title: t, ts: Date.now() }); return "ok"; });
};
SupaSocket.prototype.rpc.getIcon = function () {
  return metaGet("icon", "").then(function (u) { return String(u || ""); });
};
SupaSocket.prototype.rpc.setIcon = function (data) {
  var self = this;
  if (self._myName !== ADMIN_NAME) return Promise.resolve("admin only");
  var u = String(data || "").trim().slice(0, 500);
  if (u && u.indexOf("https://") !== 0) return Promise.resolve("invalid");
  return metaSet("icon", u).then(function () { self._broad({ t: "icon", url: u, ts: Date.now() }); return "ok"; });
};
SupaSocket.prototype.rpc.getOnline = function () {
  var self = this;
  return metaGet("fake", []).then(function (fake) {
    var names = self._presenceNames(), seen = {}, list = [];
    for (var i = 0; i < names.length; i++) { if (!seen[names[i].name]) { seen[names[i].name] = 1; list.push({ name: names[i].name, count: 1 }); } }
    fake = Array.isArray(fake) ? fake : [];
    for (var j = 0; j < fake.length; j++) if (!seen[fake[j]]) list.push({ name: fake[j], count: 1 });
    return JSON.stringify(list);
  });
};
SupaSocket.prototype.rpc.getNetworks = function () {
  var self = this;
  if (self._myName !== ADMIN_NAME) return Promise.resolve("admin only");
  return self.rpc.getOnline.call(self).then(function (j) {
    var list = JSON.parse(j);
    return JSON.stringify(list.map(function (e) { return { name: e.name, loc: "", online: 1, isProxy: 0, net: [] }; }));
  });
};
SupaSocket.prototype.rpc.getPfps = function () {
  return metaGet("pfps", {}).then(function (p) { return JSON.stringify(p && typeof p === "object" ? p : {}); });
};
SupaSocket.prototype.rpc.getVerified = function () {
  return metaGet("verified", []).then(function (v) { return JSON.stringify(Array.isArray(v) ? v : []); });
};
SupaSocket.prototype.rpc.setName = function (data) {
  var self = this;
  var obj = data;
  if (typeof obj === "string") { try { obj = JSON.parse(obj); } catch (e) { obj = { name: obj }; } }
  obj = obj || {};
  var name = String(obj.name || "").trim().slice(0, 20);
  var pass = String(obj.password || obj.pass || "");
  if (!name) name = randName();
  if (nameHasBlacklisted(name)) return Promise.resolve("blocked_word");
  if (!nameValid(name)) return Promise.resolve("invalid");
  var uid = String(obj.uid || "").trim();
  if (/^[A-Za-z0-9_-]{6,40}$/.test(uid)) self._myUid = uid;
  function finish(finalName) {
    var old = self._myName;
    var first = !self._named;
    self._myName = finalName;
    self._named = true;
    try {
      if (obj.pfp !== undefined) {
        var u = String(obj.pfp || "");
        if (u && u.indexOf("https://") !== 0) u = "";
        metaGet("pfps", {}).then(function (p) {
          p = (p && typeof p === "object") ? p : {};
          if (u) p[finalName] = u; else delete p[finalName];
          metaSet("pfps", p);
          self._broad({ t: "pfp", name: finalName, url: u });
        });
      }
    } catch (e) {}
    self._ensureInbox(finalName).then(function () {
      try { self._room.track({ name: finalName, uid: self._myUid || "", named: true }); } catch (e) {}
      if (first) self._broad({ t: "system", text: finalName + " joined", ts: Date.now() });
      else if (old && old !== finalName) {
        self._broad({ t: "rename", from: old, to: finalName, uid: self._myUid || "", ts: Date.now() });
        self._broad({ t: "system", text: old + " is now " + finalName, ts: Date.now() });
      }
      self._presence();
    });
    return "ok";
  }
  if (/^admin$/i.test(name)) {
    if (!pass) return Promise.resolve("password_required");
    return fetch("./api/admin-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pass }) }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) return "wrong_password";
      return finish(ADMIN_NAME);
    }).catch(function () { return "wrong_password"; });
  }
  var prot = protectedUser(name);
  if (prot) {
    if (!pass) return Promise.resolve("password_required");
    return hashPass(pass, prot.salt).then(function (h) {
      if (h !== prot.hash) return "wrong_password";
      return finish(prot.name);
    });
  }
  return Promise.all([metaGet("bans", []), metaGet("verified", [])]).then(function (r) {
    var bans = Array.isArray(r[0]) ? r[0] : [];
    for (var i = 0; i < bans.length; i++) if (bans[i] && bans[i].name === name) return "banned";
    var others = self._presenceNames().filter(function (x) { return x.name.toLowerCase() === name.toLowerCase(); });
    for (var j = 0; j < others.length; j++) {
      if (!(self._myUid && others[j].uid && others[j].uid === self._myUid)) return "name_taken";
    }
    return finish(name);
  }).catch(function () { return finish(name); });
};
SupaSocket.prototype.rpc.fakeSay = function (data) {
  var self = this;
  if (self._myName !== ADMIN_NAME) return Promise.resolve("admin only");
  var d = {};
  try { d = JSON.parse(data); } catch (e) {}
  var name = String(d.name || "").trim().slice(0, 20);
  var text = String(d.text || "").trim().slice(0, 500);
  if (!nameValid(name) || nameHasBlacklisted(name) || name === ADMIN_NAME) return Promise.resolve("invalid");
  if (!text) return Promise.resolve("invalid");
  var now = Date.now();
  return metaGet("fake", []).then(function (fake) {
    fake = Array.isArray(fake) ? fake : [];
    if (fake.indexOf(name) === -1) fake.push(name);
    return metaSet("fake", fake).then(function () {
      try {
        rest("messages", "POST", { ts: now, sender: name, type: "chat", text: text }).catch(function () {});
      } catch (e) {}
      self._broad({ t: "chat", from: name, text: text, id: now + "-" + Math.floor(Math.random() * 1000), ts: now });
      self._presence();
      return "ok";
    });
  });
};
SupaSocket.prototype.rpc.getFakeUsers = function () {
  var self = this;
  if (self._myName !== ADMIN_NAME) return Promise.resolve("admin only");
  return metaGet("fake", []).then(function (f) { return JSON.stringify(Array.isArray(f) ? f : []); });
};
SupaSocket.prototype.rpc.clearAll = function () {
  var self = this;
  if (self._myName !== ADMIN_NAME) return Promise.resolve("admin only");
  try { rest("messages?type=not.like.dm.*", "DELETE").catch(function () {}); } catch (e) {}
  self._broad({ t: "clear", ts: Date.now() });
  return Promise.resolve("ok");
};
SupaSocket.prototype.rpc.clearState = function () {
  var self = this;
  if (self._myName !== ADMIN_NAME) return Promise.resolve("admin only");
  return Promise.resolve("ok");
};
SupaSocket.prototype.rpc.banUser = function (data) {
  var self = this;
  return metaGet("verified", []).then(function (v) {
    var verified = Array.isArray(v) ? v : [];
    if (self._myName !== ADMIN_NAME && verified.indexOf(self._myName) === -1) return "admin only";
    var d = {};
    try { d = JSON.parse(data); } catch (e) {}
    var target = String(d.name || "").trim().slice(0, 20);
    if (!target || target === ADMIN_NAME) return "invalid";
    if (self._myName !== ADMIN_NAME && protectedUser(target)) return "protected";
    return metaGet("bans", []).then(function (b) {
      var bans = Array.isArray(b) ? b : [];
      if (bans.some(function (r) { return r && r.name === target; })) return "already banned";
      bans.push({ name: target });
      return metaSet("bans", bans).then(function () {
        return metaGet("fake", []).then(function (fake) {
          fake = Array.isArray(fake) ? fake.filter(function (x) { return x !== target; }) : [];
          return metaSet("fake", fake).then(function () {
            self._broad({ t: "system", text: target + " was banned", ts: Date.now() });
            self._broad({ t: "ban", name: target, ts: Date.now() });
            self._presence();
            return "ok";
          });
        });
      });
    });
  });
};
SupaSocket.prototype.rpc.unbanUser = function (data) {
  var self = this;
  return metaGet("verified", []).then(function (v) {
    var verified = Array.isArray(v) ? v : [];
    if (self._myName !== ADMIN_NAME && verified.indexOf(self._myName) === -1) return "admin only";
    var d = {};
    try { d = JSON.parse(data); } catch (e) {}
    var target = String(d.name || "").trim().slice(0, 20);
    if (!target) return "invalid";
    if (self._myName !== ADMIN_NAME && protectedUser(target)) return "protected";
    return metaGet("bans", []).then(function (b) {
      var bans = (Array.isArray(b) ? b : []).filter(function (r) { return !(r && r.name === target); });
      return metaSet("bans", bans).then(function () {
        self._broad({ t: "unban", name: target, ts: Date.now() });
        return "ok";
      });
    });
  });
};
SupaSocket.prototype.rpc.verifyUser = function (data) {
  var self = this;
  if (self._myName !== ADMIN_NAME) return Promise.resolve("admin only");
  var d = {};
  try { d = JSON.parse(data); } catch (e) {}
  var target = String(d.name || "").trim().slice(0, 20);
  if (!target || target === ADMIN_NAME) return Promise.resolve("invalid");
  return metaGet("verified", []).then(function (v) {
    var arr = Array.isArray(v) ? v : [];
    if (arr.indexOf(target) !== -1) return "already";
    arr.push(target);
    return metaSet("verified", arr).then(function () {
      self._broad({ t: "verified", name: target, ts: Date.now() });
      return "ok";
    });
  });
};
SupaSocket.prototype.rpc.unverifyUser = function (data) {
  var self = this;
  if (self._myName !== ADMIN_NAME) return Promise.resolve("admin only");
  var d = {};
  try { d = JSON.parse(data); } catch (e) {}
  var target = String(d.name || "").trim().slice(0, 20);
  if (!target) return Promise.resolve("invalid");
  return metaGet("verified", []).then(function (v) {
    var arr = (Array.isArray(v) ? v : []).filter(function (x) { return x !== target; });
    return metaSet("verified", arr).then(function () {
      self._broad({ t: "unverified", name: target, ts: Date.now() });
      return "ok";
    });
  });
};
SupaSocket.prototype.rpc.logoutProtected = function () {
  var self = this;
  if (self._myName !== ADMIN_NAME) return Promise.resolve("admin only");
  return Promise.resolve(JSON.stringify({ ok: true, names: [] }));
};
function dmPreview(m) {
  if (!m) return "";
  if (m.text) return String(m.text).slice(0, 80);
  if (m.caption) return String(m.caption).slice(0, 80);
  if (m.url) return "[photo]";
  return "";
}
SupaSocket.prototype._dmThreads = function () {
  var self = this;
  return Promise.all([dmRowsAll(), metaGet("verified", [])]).then(function (r) {
    var rows = r[0], verified = Array.isArray(r[1]) ? r[1] : [];
    var me = self._myName;
    var mine = (me === ADMIN_NAME) || verified.indexOf(me) !== -1;
    if (!me || !mine) return [];
    var groups = {};
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i], meta = {};
      try { meta = JSON.parse(row.reply_to || "{}"); } catch (e) {}
      if (!meta.a || !meta.b) continue;
      if (meta.a !== me && meta.b !== me) continue;
      var peer = meta.a === me ? meta.b : meta.a;
      if (!groups[row.type]) groups[row.type] = { peer: peer, rows: [] };
      groups[row.type].rows.push(row);
    }
    var out = [];
    for (var k in groups) {
      var g = groups[k];
      g.rows.sort(function (a, b) { return Number(a.ts) - Number(b.ts); });
      var lastRow = g.rows[g.rows.length - 1];
      var last = dmRowToMsg(lastRow).msg;
      out.push({ peer: g.peer, ts: Number(lastRow.ts) || 0, unread: 0, from: lastRow.sender, preview: dmPreview(last), read: 0 });
    }
    out.sort(function (a, b) { return b.ts - a.ts; });
    return out;
  });
};
SupaSocket.prototype.rpc.getDmThreads = function () {
  return this._dmThreads().then(function (t) { return JSON.stringify(t); });
};
SupaSocket.prototype.rpc.getDm = function (data) {
  var self = this;
  var peer = "";
  try { peer = String((JSON.parse(data) || {}).peer || ""); } catch (e) { peer = String(data || ""); }
  peer = peer.trim().slice(0, 20);
  if (!peer || peer === self._myName) return Promise.resolve("{}");
  return self._dmPairKey(self._myName, peer).then(function (key) {
    return restJson("messages?select=id,ts,sender,type,text,url,dur,size,reply_to&type=eq." + key + "&order=ts.asc&limit=5000").then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      var msgs = rows.map(function (row) { return dmRowToMsg(row).msg; });
      return JSON.stringify({ peer: peer, msgs: msgs, read: 0 });
    });
  }).catch(function () { return "{}"; });
};
SupaSocket.prototype.rpc.dmDelete = function (data) {
  var self = this;
  var peer = "";
  try { peer = String((JSON.parse(data) || {}).peer || ""); } catch (e) { peer = String(data || ""); }
  peer = peer.trim().slice(0, 20);
  if (!peer || peer === self._myName) return Promise.resolve("invalid");
  return self._dmPairKey(self._myName, peer).then(function (key) {
    return rest("messages?type=eq." + key, "DELETE").then(function () {
      self._inboxSend(peer, { t: "dm", peer: self._myName, ev: "delete", ts: Date.now() });
      return "ok";
    }).catch(function () { return "ok"; });
  });
};
SupaSocket.prototype.rpc.adminDmThreads = function () {
  var self = this;
  if (self._myName !== ADMIN_NAME) return Promise.resolve("[]");
  return dmRowsAll().then(function (rows) {
    var groups = {};
    for (var i = 0; i < rows.length; i++) {
      var meta = {};
      try { meta = JSON.parse(rows[i].reply_to || "{}"); } catch (e) {}
      if (!meta.a || !meta.b) continue;
      if (!groups[rows[i].type]) groups[rows[i].type] = { a: meta.a, b: meta.b, rows: [] };
      groups[rows[i].type].rows.push(rows[i]);
    }
    var out = [];
    for (var k in groups) {
      var g = groups[k];
      g.rows.sort(function (a, b) { return Number(a.ts) - Number(b.ts); });
      var lastRow = g.rows[g.rows.length - 1];
      out.push({ a: g.a, b: g.b, ts: Number(lastRow.ts) || 0, count: g.rows.length, from: lastRow.sender, preview: dmPreview(dmRowToMsg(lastRow).msg) });
    }
    out.sort(function (a, b) { return b.ts - a.ts; });
    return JSON.stringify(out);
  });
};
function adminPairOf(data) {
  var d = {};
  try { d = JSON.parse(data); } catch (e) { return null; }
  var a = String(d.a || "").slice(0, 20), b = String(d.b || "").slice(0, 20);
  if (!a || !b) return null;
  return [a, b];
}
SupaSocket.prototype.rpc.adminDm = function (data) {
  var self = this;
  if (self._myName !== ADMIN_NAME) return Promise.resolve("{}");
  var pair = adminPairOf(data);
  if (!pair) return Promise.resolve("{}");
  return self._dmPairKey(pair[0], pair[1]).then(function (key) {
    return restJson("messages?select=id,ts,sender,type,text,url,dur,size,reply_to&type=eq." + key + "&order=ts.asc&limit=5000").then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      return JSON.stringify({ a: pair[0], b: pair[1], msgs: rows.map(function (r) { return dmRowToMsg(r).msg; }) });
    });
  });
};
SupaSocket.prototype.rpc.adminDmDeleteMsg = function (data) {
  var self = this;
  if (self._myName !== ADMIN_NAME) return Promise.resolve("admin only");
  var d = {};
  try { d = JSON.parse(data) || {}; } catch (e) { return Promise.resolve("invalid"); }
  var pair = adminPairOf(data);
  var id = String(d.id || "").slice(0, 64);
  if (!pair || !id) return Promise.resolve("invalid");
  return self._dmPairKey(pair[0], pair[1]).then(function (key) {
    var rowId = String(id).replace(/^sb-/, "");
    var q = isNaN(Number(rowId)) ? "messages?type=eq." + key : "messages?id=eq." + rowId;
    return rest(q, "DELETE").then(function () {
      var p = { t: "dm", ev: "del", id: id, from: "", ts: Date.now() };
      self._inboxSend(pair[0], Object.assign({}, p, { peer: pair[1] }));
      self._inboxSend(pair[1], Object.assign({}, p, { peer: pair[0] }));
      return "ok";
    }).catch(function () { return "missing"; });
  });
};
SupaSocket.prototype.rpc.adminDmDeleteAll = function (data) {
  var self = this;
  if (self._myName !== ADMIN_NAME) return Promise.resolve("admin only");
  var pair = adminPairOf(data);
  if (!pair) return Promise.resolve("invalid");
  return self._dmPairKey(pair[0], pair[1]).then(function (key) {
    return rest("messages?type=eq." + key, "DELETE").then(function () {
      self._inboxSend(pair[0], { t: "dm", peer: pair[1], ev: "delete", ts: Date.now() });
      self._inboxSend(pair[1], { t: "dm", peer: pair[0], ev: "delete", ts: Date.now() });
      return "ok";
    }).catch(function () { return "missing"; });
  });
};
SupaSocket.prototype.rpc.getDeleted = function () {
  var self = this;
  if (self._myName !== ADMIN_NAME) return Promise.resolve("[]");
  return metaGet("deleted", []).then(function (d) { return JSON.stringify(Array.isArray(d) ? d : []); });
};
SupaSocket.prototype.rpc.clearDeleted = function () {
  var self = this;
  if (self._myName !== ADMIN_NAME) return Promise.resolve("admin only");
  return metaSet("deleted", []).then(function () { return "ok"; });
};
SupaSocket.prototype.rpc.importDeleted = function (data) {
  var self = this;
  if (self._myName !== ADMIN_NAME) return Promise.resolve("admin only");
  var list = [];
  try { list = JSON.parse(data); } catch (e) { return Promise.resolve("[]"); }
  if (!Array.isArray(list)) return Promise.resolve("[]");
  return metaGet("deleted", []).then(function (d) {
    var arr = Array.isArray(d) ? d : [], seen = {}, i;
    for (i = 0; i < arr.length; i++) if (arr[i] && arr[i].from) seen[arr[i].from + "|" + arr[i].ts] = 1;
    for (i = 0; i < list.length && arr.length < 300; i++) {
      var r = list[i];
      if (!r || !r.from || r.ts == null || seen[r.from + "|" + r.ts]) continue;
      seen[r.from + "|" + r.ts] = 1;
      arr.push(r);
    }
    arr.sort(function (a, b) { return (Number(b.at || b.ts) || 0) - (Number(a.at || a.ts) || 0); });
    return metaSet("deleted", arr).then(function () { return JSON.stringify({ added: 0, total: arr.length }); });
  });
};
window.root = {
  profanity: null,
  kv: { identity: kvStore("identity") },
  superFetch: function (url, opts) { return fetch(url, opts); },
  uploadPlugin: uploadBlob,
  ai: aiTranslate,
  createServerSocket: function () { return new SupaSocket(); }
};
fetch("./profanity.json").then(function (r) { return r.json(); }).then(function (a) {
  PROF = Array.isArray(a) ? a : [];
  window.root.profanity = { selectAll: PROF.map(function (w) { return { evaluateItem: w }; }), getLength: PROF.length };
}).catch(function () { window.root.profanity = { selectAll: [], getLength: 0 }; });
window.root.profanity = { selectAll: [], getLength: 0 };

(function diag() {
  var logs = [];
  var box = null;
  function render() {
    if (!box) return;
    try {
      var g = document.getElementById("gateOverlay");
      var mods = ["tacModal", "ageModal", "nickModal", "bannedModal", "vpnModal", "regionModal"].filter(function (id) {
        var el = document.getElementById(id);
        return el && !el.classList.contains("hide");
      });
      box.textContent = "gate:" + (g && !g.classList.contains("hide") ? "SHOWN" : "hidden") +
        " modals:[" + mods.join(",") + "] sock:" + (window.__sockState == null ? "?" : window.__sockState) +
        " root:" + (window.root ? "ok" : "MISSING") + "\n" + logs.join("\n");
    } catch (e) {}
  }
  function log(s) {
    logs.push(s);
    if (logs.length > 12) logs.shift();
    render();
  }
  window.addEventListener("error", function (e) {
    log("ERR: " + (e.message || e.error) + " @" + String(e.filename || "").split("/").pop() + ":" + (e.lineno || "?"));
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    log("REJ: " + String((r && (r.message || r)) || r).slice(0, 160));
  });
  function boot() {
    box = document.createElement("div");
    box.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:2147483647;max-width:92vw;max-height:36vh;overflow:auto;background:rgba(0,0,0,.85);color:#0f0;font:11px/1.5 monospace;padding:8px 10px;border-radius:8px;white-space:pre-wrap;";
    document.body.appendChild(box);
    log("diag on");
    setInterval(render, 2000);
    try {
      var orig = window.root.createServerSocket;
      window.root.createServerSocket = function () {
        log("socket creating");
        window.__sockState = 0;
        var s = orig();
        if (s && s.opened && s.opened.then) s.opened.then(function () { log("socket OPEN"); }, function (er) { log("socket FAIL " + String(er && er.message || er)); });
        return s;
      };
    } catch (e) {}
    setTimeout(function () {
      try {
        var g = document.getElementById("gateOverlay");
        var anyModal = ["tacModal", "ageModal", "nickModal", "bannedModal", "vpnModal", "regionModal"].some(function (id) {
          var el = document.getElementById(id);
          return el && !el.classList.contains("hide");
        });
        if (g && !g.classList.contains("hide") && !anyModal && window.__sockState === 1) {
          var t = document.getElementById("tacModal");
          if (t) { t.classList.remove("hide"); log("watchdog: forced terms popup"); }
        }
      } catch (e) {}
    }, 6000);
  }
  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
})();
