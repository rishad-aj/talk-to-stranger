
const ROOM = "chat:room";
const MAX_MSGS = 100;
const MAX_TEXT = 500;
const MAX_NAME = 20;
// VPN / proxy gate. `conn.isProxy` is the platform's own VPN/datacenter signal,
// and clients also self-report a VPN through their location lookup; either one
// refuses the connection a name. Flip to false to let VPN users back in.
const BLOCK_VPN = true;
// The quick-reaction bar's fixed row. The server accepts *any* emoji now (see
// isEmoji), because the bar's "+" opens a full picker; this list is only the
// client's default row. Identities are stored
// as "u:<uid>" when the connection has one, else "n:<nickname>", so a rename
// doesn't lose counts.
const RX_EMOJIS = ["\u2764\uFE0F", "\uD83D\uDC4D", "\uD83D\uDC4E", "\uD83D\uDD25", "\uD83D\uDE02", "\uD83D\uDC4F", "\uD83D\uDE01"];
const RX_MAX_USERS = 120;
// True for an emoji or an emoji sequence (ZWJ joins, flags, keycaps, tag flags,
// variation selectors). Written with explicit code-point ranges so it needs no
// Unicode property escapes. Every code point must be emoji-ish and the sequence
// must contain at least one pictograph, which refuses letters, spaces, control
// characters and long strings in one pass.
function isEmoji(s) {
  if (typeof s !== "string" || !s) return false;
  const cps = [];
  for (const ch of s) cps.push(ch.codePointAt(0));
  if (cps.length > 12) return false;
  let pict = 0;
  for (const c of cps) {
    if (c >= 0x1F000 && c <= 0x1FAFF) { pict++; continue; }        // pictographs, symbols, flags
    if (c >= 0x2600 && c <= 0x27BF) { pict++; continue; }          // misc symbols, dingbats
    if (c >= 0x2B00 && c <= 0x2BFF) { pict++; continue; }          // misc symbols and arrows
    if (c >= 0x2190 && c <= 0x21FF) continue;                       // arrows
    if (c >= 0x2300 && c <= 0x23FF) continue;                       // misc technical
    if (c >= 0x2900 && c <= 0x297F) continue;                       // supplemental arrows
    if (c >= 0x3030 && c <= 0x303D) continue;                       // wavy dash, part alternation
    if (c === 0x00A9 || c === 0x00AE || c === 0x2122 || c === 0x2139 ||
        c === 0x203C || c === 0x2049 || c === 0x25AA || c === 0x25AB ||
        c === 0x25B6 || c === 0x25C0 || c === 0x25FB || c === 0x25FC ||
        c === 0x25FD || c === 0x25FE || c === 0x2B05 || c === 0x2B06 ||
        c === 0x2B07 || c === 0x2B1B || c === 0x2B1C || c === 0x2B50 ||
        c === 0x2B55 || c === 0x2934 || c === 0x2935) continue;
    if (c === 0x200D || c === 0x20E3) continue;                     // ZWJ, keycap combiner
    if (c >= 0xFE00 && c <= 0xFE0F) { if (c === 0xFE0F) pict++; continue; }  // variation selectors
    if (c >= 0xE0020 && c <= 0xE007F) continue;                     // flag tag characters
    if (c === 0x23 || c === 0x2A || (c >= 0x30 && c <= 0x39)) continue;      // keycap bases
    return false;
  }
  return pict > 0;
}
// Reactions live in their own region of the state buffer, keyed by "<from>|<ts>",
// so they survive the author's message being evicted from the rolling history
// block - and so messages the client renders from the external history store
// (which the server never saw) can still carry reactions. The region sits well
// clear of the message block (100 x 60KB max) and of the end-anchored config
// regions (bans/title/icon/verified), which are mapped backwards from the end.
const RX_OFF = 8 * 1024 * 1024;
const RX_STORE_BYTES = 1 << 19;
const RX_STORE_MAX = 400;
let rxStore = null;
// Display names for reaction identities. Identities are opaque ("u:<uid>" when
// the connection has a uid, else "n:<nick>"), so the names live in their own
// small region of the reserved reaction space and ride along with every
// reaction (live broadcast + getReactions) - that's what lets any client, even
// a freshly loaded one, show who reacted without resolving uids itself. The
// map also doubles as a uid->name cache, seeded from the history block.
const RX_NAMES_OFF = RX_OFF + RX_STORE_BYTES;
const RX_NAMES_BYTES = 1 << 19;
const RX_NAMES_MAX = 800;
let rxNames = null;
const conns = new Map();
const netMsgTimes = new Map();
const lastClearTimes = new Map();
const fakePresence = new Set();
const knownFake = new Set();
let adminHidden = false;

function u16(v, o) { state[o] = v & 255; state[o + 1] = (v >> 8) & 255; }
function u16read(o) { return state[o] | (state[o + 1] << 8); }
function u32(v, o) { state[o] = v & 255; state[o + 1] = (v >> 8) & 255; state[o + 2] = (v >> 16) & 255; state[o + 3] = (v >>> 24) & 255; }
function u32read(o) { return (state[o] | (state[o + 1] << 8) | (state[o + 2] << 16) | (state[o + 3] << 24)) >>> 0; }

// state layout:
//   bytes 0-1 : u16 message count
//   then records: u32 jsonByteLength + json bytes (JSON of {t,from,text,url,dur,size,ts})
function historyBytes() {
  const n = u16read(0);
  let off = 2;
  for (let i = 0; i < n; i++) { const l = u32read(off); off += 4 + l; }
  return off - 2;
}

function addToHistory(json) {
  const b = utf8Encode(json);
  if (b.length > 60000) return;
  let off = 2 + historyBytes();
  let n = u16read(0);
  if (n >= MAX_MSGS) {
    const evict = 4 + u32read(2);
    const total = 2 + historyBytes();
    for (let i = 2 + evict; i < total; i++) state[i - evict] = state[i];
    off -= evict;
    n--;
  }
  u32(b.length, off);
  for (let i = 0; i < b.length; i++) state[off + 4 + i] = b[i];
  u16(n + 1, 0);
}

function readHistory(bans) {
  const n = u16read(0);
  let off = 2;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const l = u32read(off); off += 4;
    const json = utf8Decode(state, off, l);
    off += l;
    if (bans && bans.length) {
      let m = null;
      try { m = JSON.parse(json); } catch (e) {}
      if (m && bans.some((r) => r && r.name === m.from)) {
        m.banned = true;
        parts.push(JSON.stringify(m));
        continue;
      }
    }
    parts.push(json);
  }
  return "[" + parts.join(",") + "]";
}

function renameInHistory(oldName, newName, uid) {
  if (!oldName || !newName || oldName === newName) return;
  const n = u16read(0);
  let off = 2;
  const keep = [];
  let changed = false;
  for (let i = 0; i < n; i++) {
    const l = u32read(off); off += 4;
    let json = utf8Decode(state, off, l);
    off += l;
    let m = null;
    try { m = JSON.parse(json); } catch (e) {}
    if (m && m.from === oldName && (!(uid && m.uid) || m.uid === uid)) {
      m.from = newName;
      if (m.replyTo && m.replyTo.from === oldName) m.replyTo.from = newName;
      json = JSON.stringify(m);
      changed = true;
    }
    keep.push(json);
  }
  if (!changed) return;
  let size = 0;
  for (const j of keep) size += 4 + utf8Encode(j).length;
  if (size + 2 > state.length) return;
  let o = 2;
  for (const j of keep) {
    const b = utf8Encode(j);
    u32(b.length, o); o += 4;
    for (let i = 0; i < b.length; i++) state[o + i] = b[i];
    o += b.length;
  }
  u16(keep.length, 0);
}

function removeFromHistory(id, author) {
  const n = u16read(0);
  let off = 2;
  const keep = [];
  let removed = false;
  for (let i = 0; i < n; i++) {
    const l = u32read(off); off += 4;
    const json = utf8Decode(state, off, l);
    off += l;
    let m = null;
    try { m = JSON.parse(json); } catch (e) {}
    if (!removed && m && m.id === id && (!author || m.from === author)) {
      removed = true;
      if (m.from && m.ts) dropReactions(m.from, m.ts);
    }
    else keep.push(json);
  }
  if (!removed) return false;
  let o = 2;
  for (const j of keep) {
    const b = utf8Encode(j);
    u32(b.length, o); o += 4;
    for (let i = 0; i < b.length; i++) state[o + i] = b[i];
    o += b.length;
  }
  u16(keep.length, 0);
  return true;
}

function editMessage(id, author, text) {
  const n = u16read(0);
  let off = 2;
  const keep = [];
  let edited = false;
  for (let i = 0; i < n; i++) {
    const l = u32read(off); off += 4;
    const json = utf8Decode(state, off, l);
    off += l;
    let msg = null;
    try { msg = JSON.parse(json); } catch (e) {}
    if (!edited && msg && msg.id === id && (!author || msg.from === author)) {
      if (msg.t === "chat") {
        if (!text) { keep.push(json); continue; }
        msg.text = text;
      } else if (msg.t === "img") {
        if (text) msg.caption = text;
        else delete msg.caption;
      } else {
        keep.push(json);
        continue;
      }
      msg.edited = true;
      keep.push(JSON.stringify(msg));
      edited = true;
      continue;
    }
    keep.push(json);
  }
  if (!edited) return false;
  let size = 0;
  for (const j of keep) size += 4 + utf8Encode(j).length;
  if (size + 2 > state.length) return false;
  let o = 2;
  for (const j of keep) {
    const b = utf8Encode(j);
    u32(b.length, o); o += 4;
    for (let i = 0; i < b.length; i++) state[o + i] = b[i];
    o += b.length;
  }
  u16(keep.length, 0);
  return true;
}

function findMsg(id) {
  const n = u16read(0);
  let off = 2;
  for (let i = 0; i < n; i++) {
    const l = u32read(off); off += 4;
    const json = utf8Decode(state, off, l);
    off += l;
    let m = null;
    try { m = JSON.parse(json); } catch (e) {}
    if (m && m.id === id) return m;
  }
  return null;
}

// The client renders history from an external store where messages carry the
// author's timestamp, not the server's generated id. Resolve by (author, ts)
// when the id doesn't match.
function findByTsFrom(from, ts) {
  if (!from || ts == null) return null;
  const n = u16read(0);
  let off = 2;
  for (let i = 0; i < n; i++) {
    const l = u32read(off); off += 4;
    const json = utf8Decode(state, off, l);
    off += l;
    let m = null;
    try { m = JSON.parse(json); } catch (e) {}
    if (m && m.from === from && Number(m.ts) === Number(ts)) return m;
  }
  return null;
}

// Who authored a stored message? A per-browser uid when both sides have one
// (a nickname is neither unique nor permanent), else the name for old records.
function msgOwnedBy(msg, c, fromHint) {
  if (msg) return (msg.uid && c.uid) ? msg.uid === c.uid : !!msg.from && msg.from === c.name;
  return !!fromHint && fromHint === c.name;
}

function replaceWithDelNote(id, by) {
  const n = u16read(0);
  let off = 2;
  const keep = [];
  let replaced = false;
  let orig = null;
  for (let i = 0; i < n; i++) {
    const l = u32read(off); off += 4;
    const json = utf8Decode(state, off, l);
    off += l;
    let m = null;
    try { m = JSON.parse(json); } catch (e) {}
    if (!replaced && m && m.id === id && m.t !== "delnote") {
      if (m.from && m.ts) dropReactions(m.from, m.ts);
      const o = { t: m.t || "chat" };
      if (m.text) o.text = m.text;
      if (m.caption) o.caption = m.caption;
      if (m.url) o.url = m.url;
      if (m.dur != null) o.dur = m.dur;
      orig = o;
      const note = { t: "delnote", id: m.id, ts: m.ts, from: m.from, orig };
      if (by) note.by = String(by).slice(0, MAX_NAME);
      m = note;
      keep.push(JSON.stringify(m));
      replaced = true;
      continue;
    }
    keep.push(json);
  }
  if (!replaced) return false;
  let o = 2;
  for (const j of keep) {
    const b = utf8Encode(j);
    u32(b.length, o); o += 4;
    for (let i = 0; i < b.length; i++) state[o + i] = b[i];
    o += b.length;
  }
  u16(keep.length, 0);
  return orig;
}

function toggleFlag(id) {
  const n = u16read(0);
  let off = 2;
  const keep = [];
  let flagged = null;
  for (let i = 0; i < n; i++) {
    const l = u32read(off); off += 4;
    const json = utf8Decode(state, off, l);
    off += l;
    let msg = null;
    try { msg = JSON.parse(json); } catch (e) {}
    if (flagged === null && msg && msg.id === id) {
      msg.flagged = !msg.flagged;
      flagged = !!msg.flagged;
      keep.push(JSON.stringify(msg));
      continue;
    }
    keep.push(json);
  }
  if (flagged === null) return null;
  let o = 2;
  for (const j of keep) {
    const b = utf8Encode(j);
    u32(b.length, o); o += 4;
    for (let i = 0; i < b.length; i++) state[o + i] = b[i];
    o += b.length;
  }
  u16(keep.length, 0);
  return flagged;
}

// Reactions live in their own durable region (see RX_OFF), not on the message
// records, so they outlive the message's time in the rolling history block and
// work for messages the server never mirrored itself.
function rxKeyOf(from, ts) { return String(from) + "|" + String(Number(ts) || 0); }

function loadRx() {
  if (rxStore) return rxStore;
  rxStore = new Map();
  try {
    const len = u32read(RX_OFF);
    if (len > 1 && len + 4 < RX_STORE_BYTES) {
      const obj = JSON.parse(utf8Decode(state, RX_OFF + 4, len));
      for (const k of Object.keys(obj)) {
        const e = obj[k];
        if (e && e.f && e.rx && typeof e.rx === "object") rxStore.set(k, { f: String(e.f), t: Number(e.t) || 0, rx: e.rx });
      }
    }
  } catch (err) {}
  return rxStore;
}

function persistRx() {
  const store = loadRx();
  const obj = {};
  for (const [k, e] of store) obj[k] = { f: e.f, t: e.t, rx: e.rx };
  const b = utf8Encode(JSON.stringify(obj));
  if (b.length + 4 > RX_STORE_BYTES) return;
  u32(b.length, RX_OFF);
  for (let i = 0; i < b.length; i++) state[RX_OFF + 4 + i] = b[i];
}

function rxIdentity(c) { return c.uid ? "u:" + c.uid : "n:" + c.name; }

function loadRxNames() {
  if (rxNames) return rxNames;
  rxNames = new Map();
  try {
    const len = u32read(RX_NAMES_OFF);
    if (len && len + 4 <= RX_NAMES_BYTES) {
      const obj = JSON.parse(utf8Decode(state, RX_NAMES_OFF + 4, len));
      for (const k of Object.keys(obj)) if (typeof obj[k] === "string") rxNames.set(k, obj[k]);
    }
  } catch (err) {}
  // Seed from the stored history so identities whose name was never recorded
  // (reactions stored before this map existed) still resolve. Later messages
  // win, so the most recently used nickname sticks.
  try {
    const n = u16read(0);
    let off = 2;
    for (let i = 0; i < n; i++) {
      const l = u32read(off); off += 4;
      let mm = null;
      try { mm = JSON.parse(utf8Decode(state, off, l)); } catch (err) {}
      off += l;
      if (mm && mm.uid && mm.from) rxNames.set("u:" + mm.uid, String(mm.from).slice(0, MAX_NAME));
    }
  } catch (err) {}
  return rxNames;
}

function persistRxNames() {
  const obj = {};
  for (const [k, v] of loadRxNames()) obj[k] = v;
  const b = utf8Encode(JSON.stringify(obj));
  if (b.length + 4 > RX_NAMES_BYTES) return;
  u32(b.length, RX_NAMES_OFF);
  for (let i = 0; i < b.length; i++) state[RX_NAMES_OFF + 4 + i] = b[i];
}

// Remember what an identity calls itself right now, so the who-reacted list can
// still name someone after their messages have aged out of the history block.
function noteReactorName(who, name) {
  if (!who || !name) return;
  name = String(name).slice(0, MAX_NAME);
  const m = loadRxNames();
  if (m.get(who) === name) return;
  m.delete(who);
  m.set(who, name);
  while (m.size > RX_NAMES_MAX) m.delete(m.keys().next().value);
  persistRxNames();
}

// The subset of a reaction map's identities whose display name is known.
function rxNamesFor(rx) {
  const m = loadRxNames();
  const out = {};
  for (const emo of Object.keys(rx || {})) {
    for (const who of rx[emo]) if (m.has(who)) out[who] = m.get(who);
  }
  return out;
}

// Toggle one emoji for one identity on one message. Returns the new reaction
// map, or null when the request can't be honoured.
function toggleReaction(from, ts, who, emoji) {
  if (!from || ts == null || !isEmoji(emoji)) return null;
  const store = loadRx();
  const key = rxKeyOf(from, ts);
  const e = store.get(key) || { f: String(from).slice(0, MAX_NAME), t: Number(ts) || 0, rx: {} };
  const prev = (e.rx && typeof e.rx === "object") ? e.rx : {};
  // Any emoji may be reacted with now (the picker), so copy whatever is already
  // stored - minus the one being toggled - instead of walking a fixed whitelist.
  const next = {};
  for (const k of Object.keys(prev)) {
    if (k === emoji || !prev[k] || !prev[k].length) continue;
    next[k] = prev[k].slice(0, RX_MAX_USERS);
  }
  const wasIn = !!(prev[emoji] && prev[emoji].indexOf(who) !== -1);
  const list = prev[emoji] ? prev[emoji].filter((x) => x !== who).slice(0, RX_MAX_USERS) : [];
  if (!wasIn && list.length < RX_MAX_USERS) list.push(who);
  if (list.length) next[emoji] = list;
  store.delete(key);
  if (Object.keys(next).length) {
    // Re-inserting at the end doubles as "most recently touched"; the oldest
    // entry is evicted if the store grows past its cap.
    store.set(key, { f: e.f, t: e.t, rx: next });
    while (store.size > RX_STORE_MAX) store.delete(store.keys().next().value);
  }
  persistRx();
  return next;
}

function dropReactions(from, ts) {
  if (!from || ts == null) return;
  const store = loadRx();
  if (store.delete(rxKeyOf(from, ts))) persistRx();
}

// A rename changes both the key (author + ts) and the "n:<nick>" identities of
// nickname-only reactors, since those are keyed by name.
function renameReactions(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  const store = loadRx();
  const oldId = "n:" + oldName, newId = "n:" + newName;
  let changed = false;
  const out = new Map();
  for (const e of store.values()) {
    let f = e.f;
    if (f === oldName) { f = newName; changed = true; }
    const rx = {};
    for (const em of Object.keys(e.rx)) {
      const list = e.rx[em].map((x) => (x === oldId ? newId : x));
      if (list.some((x, i) => x !== e.rx[em][i])) changed = true;
      rx[em] = list;
    }
    out.set(rxKeyOf(f, e.t), { f, t: e.t, rx });
  }
  if (changed) { rxStore = out; persistRx(); }
}

function utf8Encode(s) {
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = s.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        i++;
      } else bytes.push(0xef, 0xbf, 0xbd);
    } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return bytes;
}

function utf8Decode(arr, off, len) {
  let out = "";
  const end = off + len;
  let i = off;
  while (i < end) {
    const b0 = arr[i];
    if (b0 < 0x80) { out += String.fromCharCode(b0); i++; }
    else if ((b0 & 0xe0) === 0xc0) { out += String.fromCharCode(((b0 & 0x1f) << 6) | (arr[i + 1] & 0x3f)); i += 2; }
    else if ((b0 & 0xf0) === 0xe0) { out += String.fromCharCode(((b0 & 0x0f) << 12) | ((arr[i + 1] & 0x3f) << 6) | (arr[i + 2] & 0x3f)); i += 3; }
    else {
      let cp = ((b0 & 0x07) << 18) | ((arr[i + 1] & 0x3f) << 12) | ((arr[i + 2] & 0x3f) << 6) | (arr[i + 3] & 0x3f);
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      i += 4;
    }
  }
  return out;
}

// Display names must be unique among live connections: if two different people
// hold the same nickname, every client attributes the other's messages to them
// (and renaming rewrites the other's history). Two tabs of the same browser
// share a uid and may share a name - they're the same person.
function nameTaken(name, conn, uid) {
  const ln = String(name || "").trim().toLowerCase();
  for (const cc of conns.values()) {
    if (conn && cc.conn === conn) continue;
    if (!cc.named || String(cc.name || "").trim().toLowerCase() !== ln) continue;
    if (uid && cc.uid && cc.uid === uid) continue;
    return true;
  }
  return false;
}
function uidValid(u) { return typeof u === "string" && /^[A-Za-z0-9_-]{6,40}$/.test(u); }
function randomGuest(conn) {
  for (let i = 0; i < 40; i++) {
    const n = "Guest" + Math.floor(1000 + Math.random() * 9000);
    if (!nameTaken(n, conn || null, null)) return n;
  }
  return "Guest" + Math.floor(100000 + Math.random() * 900000);
}

function hasEmoji(s) {
  return /(?:\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDC00-\uDFFF]|[\u00A9\u00AE\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23E9-\u23F3\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB-\u25FE\u2600-\u27BF\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299\uFE0F\u200D\u20E3])/.test(s);
}
function nameValid(n) {
  return !!n && Array.from(n).length >= 4 && !hasEmoji(n);
}

// Display-name blacklist, mirrored from the `profanity` list in main.pjs
// (322 words - re-copy if that list changes). Matching mirrors the
// chat mask: case-insensitive, stretched letters and spaced letters count.
const NAME_BLACKLIST = ["anal", "anus", "arse", "arsed", "arsehole", "arseholes", "arses", "arsewipe", "ass", "asses", "asshat", "asshats", "asshole", "assholes", "asswipe", "asswipes", "ballsack", "ballsacks", "bastard", "bastards", "beaner", "beaners", "bestiality", "bimbo", "bimbos", "bitch", "bitchass", "bitches", "bitching", "bitchy", "blowjob", "blowjobs", "bollock", "bollocks", "bollox", "boner", "boners", "boob", "boobies", "boobs", "bugger", "buggery", "bullshit", "bullshits", "bullshitter", "bullshitting", "camgirl", "camwhore", "chink", "chinks", "clit", "clits", "clitoris", "clusterfuck", "clusterfucks", "cock", "cocks", "cocksucker", "cocksuckers", "cocksucking", "cockhead", "coon", "coons", "crap", "crappy", "creampie", "cripple", "cuck", "cuckold", "cucks", "cum", "cumming", "cums", "cumshot", "cumshots", "cumslut", "cunt", "cuntface", "cunts", "cunty", "damn", "dammit", "damned", "damnit", "darkie", "darkies", "deepthroat", "dick", "dickface", "dickhead", "dickheads", "dicks", "dickwad", "dildo", "dildos", "dipshit", "dipshits", "doggystyle", "dominatrix", "douche", "douchebag", "douchebags", "douches", "dumbass", "dumbasses", "dumbfuck", "dumbfucks", "dyke", "dykes", "fag", "faggot", "faggots", "fagot", "fagots", "fags", "fellatio", "fisting", "foreskin", "foreskins", "fudgepacker", "fuck", "fuckboy", "fucked", "fucker", "fuckers", "fuckface", "fuckhead", "fuckheads", "fuckin", "fucking", "fucknut", "fucknuts", "fucks", "fucktard", "fucktards", "fuckup", "fuckups", "fuckwit", "fuckwits", "fuk", "gangbang", "gangbanged", "gangraped", "gook", "gooks", "handjob", "handjobs", "hardon", "hentai", "hooker", "hookers", "horny", "horseshit", "incest", "jackass", "jackasses", "jackoff", "jerkoff", "jerkoffs", "jizz", "jizzing", "kike", "kikes", "knobhead", "knobheads", "lolicon", "masturbate", "masturbating", "masturbation", "midget", "midgets", "milf", "milfs", "mofo", "molest", "molestation", "molester", "motherfuck", "motherfucker", "motherfuckers", "motherfucking", "muff", "necrophilia", "nigga", "niggas", "nigger", "niggers", "niglet", "niglets", "nipple", "nipples", "nutsack", "nutsacks", "nympho", "nymphos", "orgasm", "orgasms", "orgy", "paedo", "paedophile", "paki", "pakis", "pedo", "pedophile", "pedophilia", "penis", "piss", "pissed", "pisses", "pissing", "pissoff", "porn", "porno", "pornhub", "pornos", "prick", "pricks", "punani", "pussy", "pussies", "raghead", "ragheads", "rape", "raped", "rapist", "rapists", "retard", "retarded", "retardation", "retards", "rimjob", "rimjobs", "scrotum", "scumbag", "scumbags", "semen", "shag", "shagged", "shagging", "shags", "shemale", "shemales", "shit", "shitfaced", "shithead", "shitheads", "shithole", "shitholes", "shits", "shitstain", "shitstains", "shitstorm", "shitshow", "shitting", "shitty", "skank", "skanky", "skanks", "slut", "sluts", "sluttiest", "slutty", "snatch", "sodomy", "sonofabitch", "sonofabitches", "spastic", "spastics", "spaz", "spazz", "sperm", "spic", "spics", "testicle", "testicles", "thot", "thots", "threesome", "threesomes", "tit", "tits", "titties", "titty", "tosser", "tossers", "towelhead", "towelheads", "tranny", "trannies", "turd", "turds", "twat", "twats", "vagina", "vibrator", "vibrators", "wank", "wanker", "wankers", "wanking", "wanks", "wetback", "wetbacks", "whore", "whoring", "whorish", "whores", "wop", "wops", "xxx", "a55", "a55hole", "b1tch", "c0ck", "d1ck", "f4g", "f4ggot", "n1gga", "n1gger", "pr0n", "puss1", "sh1t"];
const NAME_RUNS = NAME_BLACKLIST.map((w) => {
  const runs = [];
  for (const ch of w) {
    if (runs.length && runs[runs.length - 1][0] === ch) runs[runs.length - 1][1]++;
    else runs.push([ch, 1]);
  }
  return runs;
});
function nameHasBlacklisted(n) {
  const s = String(n || "").toLowerCase();
  const L = s.length;
  if (L < 3) return false;
  const SEP = String.fromCharCode(32, 9, 10, 13, 12, 11, 160, 46, 95, 42, 45);
  const SEP_SHORT = String.fromCharCode(46, 95, 42, 45);
  const isWord = (c) => c === "_" || (c >= "a" && c <= "z") || (c >= "0" && c <= "9");
  for (let k = 0; k < NAME_BLACKLIST.length; k++) {
    const w = NAME_BLACKLIST[k];
    const runs = NAME_RUNS[k];
    const seps = w.length >= 4 ? SEP : SEP_SHORT;
    for (let i = 0; i < L; i++) {
      if (i > 0 && isWord(s[i - 1])) continue;
      let p = i, ok = true;
      for (let r = 0; r < runs.length; r++) {
        if (r > 0) { while (p < L && seps.indexOf(s[p]) !== -1) p++; }
        const ch = runs[r][0];
        const last = r === runs.length - 1;
        let got = 0;
        while (p < L) {
          if (s[p] === ch) { got++; p++; }
          else if (r > 0 && (got < runs[r][1] || !last) && seps.indexOf(s[p]) !== -1) { p++; }
          else break;
        }
        if (got < runs[r][1]) { ok = false; break; }
      }
      if (ok && (p >= L || !isWord(s[p]))) return true;
    }
  }
  return false;
}
const ADMIN_NAME = "admin";
const ADMIN_HASH = "ae06c26544ef3d6ae784659c3d88fb17fd8c84cdc95dc9659aa0b5a4d60ca58f";
const adminAttempts = new Map();

// Reserved names that require a password to use. Only salted SHA-256 hashes
// live here (this whole script is public). Secrets are verified server-side so
// renaming in devtools can't bypass them. Keep in sync with PROTECTED_NAMES on
// the client (used only to decide when to show the password field).
const PROTECTED_USERS = [
  { name: "Anya", salt: "482212aa9240f0dcee8d4692e653fbf5", hash: "880ea8a131d2589e50f65ac7752481159ae837ec904edeb6dc3cb506e97d89a3" },
  { name: "Jonathan", salt: "8deed5a1a0fe04392742b7c36af5b757", hash: "cf5893331e6c67509878f31618428a0058eab189cc23075c5e8672c280d71a19" },
];
function protectedUser(name) {
  const n = String(name || "").trim().toLowerCase();
  for (const p of PROTECTED_USERS) if (p.name.toLowerCase() === n) return p;
  return null;
}
function hashPass(pass, salt) { return sha256Hex(salt + "\u0000" + pass); }
const protectedAttempts = new Map();

function regionOf(loc) {
  if (!loc || typeof loc !== "string") return "";
  let s = loc.trim();
  if (s.endsWith(" \u26A0VPN")) s = s.slice(0, -5);
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  const country = parts.length ? parts[parts.length - 1] : "";
  if (country === "India") return "IN";
  if (country === "Pakistan") return "PK";
  return "";
}
function blockedInRegion(name, country) {
  if (name === ADMIN_NAME) return false;
  return country === "IN" || country === "PK";
}
function locIsProxy(loc) {
  return typeof loc === "string" && loc.endsWith(" \u26A0VPN");
}
// VPNs and proxies may not join - except the admin and verified users, who are
// trusted enough that a VPN is not treated as an evasion. The exemption is
// NAME-based (see `verifiedName`): a verified user behind a VPN has a different
// `conn.net`, so the net-bound `isVerified` could never recognise them.
// `conn.isProxy` is authoritative; the location suffix is the client's own IP
// lookup telling us its egress is a VPN/hosting range. `claimedName` (passed by
// the join path) tests the name being requested instead of the throwaway guest
// name the connection is still holding.
function proxyBlocked(c, claimedName) {
  if (!BLOCK_VPN || !c) return false;
  if (verifiedName(claimedName || c.name)) return false;
  return c.proxy === true || locIsProxy(c.loc);
}

const BANS_OFF = state.length - 4096;
function readBans() {
  let len = 0;
  while (BANS_OFF + len < state.length && state[BANS_OFF + len] !== 0) len++;
  if (!len) return [];
  try {
    const a = JSON.parse(utf8Decode(state, BANS_OFF, len));
    if (!Array.isArray(a)) return [];
    // Normalise older string-only ban lists into records so name + net bans coexist.
    return a.map((e) => (typeof e === "string" ? { name: e, net: null } : e));
  } catch (e) { return []; }
}
function writeBans(arr) {
  state.fill(0, BANS_OFF, state.length);
  const b = utf8Encode(JSON.stringify(arr));
  const max = state.length - BANS_OFF - 1;
  for (let i = 0; i < b.length && i < max; i++) state[BANS_OFF + i] = b[i];
}
// A user is banned if their name is banned OR their residential network group is
// banned, so simply changing their nickname no longer bypasses a ban.
function isBanned(name, net) {
  for (const r of readBans()) {
    if (r && r.name && r.name === name) return true;
    if (r && net != null && r.net != null && r.net === net) return true;
  }
  return false;
}

const TITLE_OFF = state.length - 5120;
const TITLE_MAX = 60;
function readTitle() {
  let len = 0;
  while (TITLE_OFF + len < BANS_OFF && state[TITLE_OFF + len] !== 0) len++;
  if (!len) return "";
  try {
    return String(utf8Decode(state, TITLE_OFF, len)).slice(0, TITLE_MAX);
  } catch (e) { return ""; }
}
function writeTitle(t) {
  state.fill(0, TITLE_OFF, BANS_OFF);
  const b = utf8Encode(String(t).slice(0, TITLE_MAX));
  const max = BANS_OFF - TITLE_OFF - 1;
  for (let i = 0; i < b.length && i < max; i++) state[TITLE_OFF + i] = b[i];
}

const ICON_OFF = state.length - 7168;
const ICON_MAX = 500;
function readIcon() {
  let len = 0;
  while (ICON_OFF + len < TITLE_OFF && state[ICON_OFF + len] !== 0) len++;
  if (!len) return "";
  try {
    return String(utf8Decode(state, ICON_OFF, len)).slice(0, ICON_MAX);
  } catch (e) { return ""; }
}
function writeIcon(u) {
  state.fill(0, ICON_OFF, TITLE_OFF);
  const b = utf8Encode(String(u).slice(0, ICON_MAX));
  const max = TITLE_OFF - ICON_OFF - 1;
  for (let i = 0; i < b.length && i < max; i++) state[ICON_OFF + i] = b[i];
}

const LOC_SIZE = 16384;
const VERIFIED_SIZE = 2048;
const VERIFIED_OFF = state.length - 7168 - VERIFIED_SIZE;
const LOC_OFF = state.length - 7168 - LOC_SIZE - VERIFIED_SIZE;
function readLocs() {
  let len = 0;
  while (LOC_OFF + len < VERIFIED_OFF && state[LOC_OFF + len] !== 0) len++;
  if (!len) return [];
  try {
    const a = JSON.parse(utf8Decode(state, LOC_OFF, len));
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}
function writeLocs(arr) {
  state.fill(0, LOC_OFF, VERIFIED_OFF);
  const b = utf8Encode(JSON.stringify(arr));
  const max = VERIFIED_OFF - LOC_OFF - 1;
  for (let i = 0; i < b.length && i < max; i++) state[LOC_OFF + i] = b[i];
}
const VERIFIED_MAX = state.length - 7168 - VERIFIED_OFF;
function readVerified() {
  let len = 0;
  const end = state.length - 7168;
  while (VERIFIED_OFF + len < end && state[VERIFIED_OFF + len] !== 0) len++;
  if (!len) return [];
  try {
    const a = JSON.parse(utf8Decode(state, VERIFIED_OFF, len));
    if (!Array.isArray(a)) return [];
    // Normalise older string-only lists into records so a verified name can be
    // pinned to the residential network that was connected when it was granted.
    return a.map((e) => (typeof e === "string" ? { name: e, net: null } : e)).filter((e) => e && typeof e.name === "string");
  } catch (e) { return []; }
}
function readVerifiedNames() { return readVerified().map((r) => r.name); }
function writeVerified(arr) {
  state.fill(0, VERIFIED_OFF, state.length - 7168);
  const b = utf8Encode(JSON.stringify(arr));
  const max = VERIFIED_MAX - 1;
  for (let i = 0; i < b.length && i < max; i++) state[VERIFIED_OFF + i] = b[i];
}
// A connection is verified only if its name is verified AND (the record is not
// net-bound, or its residential network group matches), so renaming to a
// verified user's nickname from another network does not grant mod powers.
function isVerified(name, net) {
  if (!name) return false;
  for (const r of readVerified()) {
    if (r.name !== name) continue;
    if (r.net == null) return true;
    return net != null && r.net === net;
  }
  return false;
}
// Name-only verification test, deliberately NOT network-bound. It exists for
// the VPN/proxy gate: a verified user behind a VPN arrives on a different
// `conn.net`, so the net-bound `isVerified` can never recognise them, and the
// whole point of that gate is that the connection's network is what we don't
// trust. It grants the *join* only - every verified power (moderation, private
// chat) still goes through the net-bound checks, so a VPN user who borrows a
// verified nickname inherits none of that nickname's abilities and is visible
// to the admin as a proxied connection.
function verifiedName(name) {
  if (!name) return false;
  if (name === ADMIN_NAME) return true;
  return readVerifiedNames().includes(name);
}
// Private chat is a verified-user feature, so both who may use it and who may
// be reached through it are decided here, not in the client. `mayDm` is the
// net-aware check for the sender (a stranger who renames to a verified
// nickname on another network gets nothing); `dmName` is the name-only check
// for a peer, which is all the server can evaluate for someone who is offline.
function mayDm(name, net) { return name === ADMIN_NAME || isVerified(name, net); }
function dmName(name) { return !!name && (name === ADMIN_NAME || readVerifiedNames().includes(name)); }
// Verified users may not moderate the admin or other verified users. A target
// is protected if it's the admin, or a genuinely verified user (name + net).
function protectedName(name) {
  if (!name || name === ADMIN_NAME) return true;
  for (const cc of conns.values()) if (cc.name === name) return isVerified(name, cc.conn.net[3]);
  return readVerifiedNames().includes(name);
}
function saveLoc(name, loc) {
  if (!name || name === ADMIN_NAME || !loc) return;
  const arr = readLocs().filter((e) => e.name !== name);
  arr.push({ name, loc, ts: Date.now() });
  writeLocs(arr);
}

const FAKE_SIZE = 2048;
const FAKE_OFF = LOC_OFF - FAKE_SIZE;
function readFakeUsers() {
  let len = 0;
  while (FAKE_OFF + len < LOC_OFF && state[FAKE_OFF + len] !== 0) len++;
  if (!len) return [];
  try {
    const a = JSON.parse(utf8Decode(state, FAKE_OFF, len));
    return Array.isArray(a) ? a.mfilter((x) => typeof x === "string") : [];
  } catch (e) { return []; }
}
function writeFakeUsers(arr) {
  state.fill(0, FAKE_OFF, LOC_OFF);
  const b = utf8Encode(JSON.stringify(arr));
  const max = LOC_OFF - FAKE_OFF - 1;
  for (let i = 0; i < b.length && i < max; i++) state[FAKE_OFF + i] = b[i];
}
function persistFakeUsers() { writeFakeUsers([...knownFake]); }
for (const f of readFakeUsers()) knownFake.add(f);
for (const f of knownFake) if (!isBanned(f, null)) fakePresence.add(f);

/* Profile pictures: a nickname -> image URL map, in its own durable region so
   the picture survives reloads, hibernation and history eviction. The region
   sits *below* every existing end-anchored config region, in space no earlier
   version of this server ever wrote, so an already-populated production state
   needs no migration. Entries are capped and the whole map is re-encoded at a
   low rate only (a join or a profile edit), so a plain JSON array is fine here.
   Layout: JSON of [{name, url}, ...] + NUL, oldest entries first. */
const PFP_SIZE = 128 * 1024;
const PFP_OFF = FAKE_OFF - PFP_SIZE;
const PFP_MAX = 200;
const PFP_URL_MAX = 400;
const PFP_RE = /^https:\/\/[^\s"'<>\\]{1,400}$/;
function readPfps() {
  let len = 0;
  while (PFP_OFF + len < FAKE_OFF && state[PFP_OFF + len] !== 0) len++;
  if (!len) return [];
  try {
    const a = JSON.parse(utf8Decode(state, PFP_OFF, len));
    if (!Array.isArray(a)) return [];
    return a.filter((e) => e && typeof e.name === "string" && e.name && typeof e.url === "string" && e.url);
  } catch (e) { return []; }
}
function writePfps(arr) {
  state.fill(0, PFP_OFF, FAKE_OFF);
  const max = FAKE_OFF - PFP_OFF - 1;
  let b = utf8Encode(JSON.stringify(arr));
  while (b.length > max && arr.length > 1) { arr.shift(); b = utf8Encode(JSON.stringify(arr)); }
  for (let i = 0; i < b.length && i < max; i++) state[PFP_OFF + i] = b[i];
}
function pfpOf(name) {
  if (!name) return "";
  for (const e of readPfps()) if (e.name === name) return e.url;
  return "";
}
function setProfilePfp(name, url) {
  if (!name) return;
  const arr = readPfps().filter((e) => e.name !== name);
  if (url) arr.push({ name, url: String(url).slice(0, PFP_URL_MAX) });
  while (arr.length > PFP_MAX) arr.shift();
  writePfps(arr);
}
// A picture belongs to the person, not to the name they happened to hold, so it
// follows them through a rename instead of being stranded on a dead nickname.
function renameProfilePfp(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  const arr = readPfps();
  let changed = false;
  for (const e of arr) if (e.name === oldName) { e.name = newName; changed = true; }
  if (changed) writePfps(arr);
}
function publishPfp(name) {
  pubsub.publish(ROOM, JSON.stringify({ t: "pfp", name, url: pfpOf(name), ts: Date.now() }));
}
function cleanPfpUrl(v) {
  const u = String(v || "").trim().slice(0, PFP_URL_MAX);
  if (!u) return "";
  return PFP_RE.test(u) ? u : "";
}

/* Direct messages: a thread per nickname pair, in its own durable region that
   sits *below* the profile-picture block (and therefore below every existing
   region), in space no earlier version of this server ever wrote - so an
   already-populated production state needs no migration. A thread is keyed by
   the two names sorted, so both sides look up the same record regardless of who
   started it, and `r` holds each side's last-read timestamp (which is all the
   client needs for unread counts and the Seen tick). Message ids are prefixed
   with "d" so they can never collide with the room's "<ts>-<rand>" ids.
   Layout: JSON of [{a, b, msgs: [...], r: {name: ts}}, ...] + NUL. Threads are
   capped per side, and whole threads (least recently active first) are evicted
   if the encoded blob would outgrow the region. */
const DM_SIZE = 8 * 1024 * 1024;
const DM_OFF = PFP_OFF - DM_SIZE;
const DM_THREAD_MAX = 300;
const DM_MSGS_MAX = 150;
let dmStore = null;
function readDm() {
  if (dmStore) return dmStore;
  let len = 0;
  while (DM_OFF + len < PFP_OFF && state[DM_OFF + len] !== 0) len++;
  if (!len) { dmStore = []; return dmStore; }
  try {
    const a = JSON.parse(utf8Decode(state, DM_OFF, len));
    dmStore = Array.isArray(a)
      ? a.filter((t) => t && typeof t.a === "string" && typeof t.b === "string" && Array.isArray(t.msgs))
      : [];
  } catch (e) { dmStore = []; }
  for (const t of dmStore) {
    if (!t.r || typeof t.r !== "object") t.r = {};
    t.msgs = t.msgs.slice(-DM_MSGS_MAX);
  }
  return dmStore;
}
function dmLastTs(t) {
  const last = t.msgs && t.msgs.length ? t.msgs[t.msgs.length - 1] : null;
  return Number(last && last.ts) || 0;
}
function saveDm() {
  const arr = dmStore || [];
  // Least recently active first out - the cheapest way to stay inside both the
  // thread count and the encoded-byte budget.
  while (arr.length > 1 && (arr.length > DM_THREAD_MAX)) {
    let oldest = 0;
    for (let i = 1; i < arr.length; i++) if (dmLastTs(arr[i]) < dmLastTs(arr[oldest])) oldest = i;
    arr.splice(oldest, 1);
  }
  const max = PFP_OFF - DM_OFF - 1;
  state.fill(0, DM_OFF, PFP_OFF);
  let b = utf8Encode(JSON.stringify(arr));
  while (b.length > max && arr.length > 1) {
    let oldest = 0;
    for (let i = 1; i < arr.length; i++) if (dmLastTs(arr[i]) < dmLastTs(arr[oldest])) oldest = i;
    arr.splice(oldest, 1);
    b = utf8Encode(JSON.stringify(arr));
  }
  for (let i = 0; i < b.length && i < max; i++) state[DM_OFF + i] = b[i];
}
function dmPair(x, y) { return x < y ? [x, y] : [y, x]; }
// Normalises the {a, b} payload the admin moderation RPCs take, so a hand-made
// call can never widen a thread key or address a self-pair.
function dmAdminPair(data) {
  let d = {};
  try { d = JSON.parse(data) || {}; } catch (e) { return null; }
  const a = String(d.a || "").trim().slice(0, MAX_NAME);
  const b = String(d.b || "").trim().slice(0, MAX_NAME);
  if (!a || !b || a === b) return null;
  return dmPair(a, b);
}
function dmThread(x, y, create) {
  const [a, b] = dmPair(x, y);
  const arr = readDm();
  for (const t of arr) if (t.a === a && t.b === b) return t;
  if (!create) return null;
  const t = { a, b, msgs: [], r: {} };
  arr.push(t);
  return t;
}
function dmThreadsFor(name) { return readDm().filter((t) => t.a === name || t.b === name); }
function dmPeerOf(t, name) { return t.a === name ? t.b : t.a; }
function dmUnread(t, name) {
  const seen = Number(t.r && t.r[name]) || 0;
  let n = 0;
  for (const m of t.msgs) if (m.from !== name && m.ts > seen) n++;
  return n;
}
// Every live connection holding that name gets the payload - which is what makes
// a second tab of the same person stay in sync, and what lets the sender's own
// copy echo back (so its optimistic bubble is replaced by the stored one).
function dmDeliver(name, payload) {
  const data = JSON.stringify(payload);
  for (const cc of conns.values()) {
    if (!cc.named || cc.name !== name) continue;
    if (blockedInRegion(cc.name, cc.country) || proxyBlocked(cc)) continue;
    cc.conn.send(data);
  }
}
// A picture, and the conversation itself, belong to the person rather than to
// the name they happened to hold, so both follow a rename.
function dmRename(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  const arr = readDm();
  let changed = false;
  for (const t of arr) {
    if (t.a === oldName) { t.a = newName; changed = true; }
    else if (t.b === oldName) { t.b = newName; changed = true; }
    for (const m of t.msgs) if (m.from === oldName) { m.from = newName; changed = true; }
    if (t.r && t.r[oldName] != null) {
      t.r[newName] = Math.max(Number(t.r[newName]) || 0, Number(t.r[oldName]) || 0);
      delete t.r[oldName];
      changed = true;
    }
  }
  if (!changed) return;
  for (const t of arr) { if (t.a > t.b) { const s = t.a; t.a = t.b; t.b = s; } }
  // A rename can make two threads describe the same pair (e.g. A->B while a
  // B thread already existed); fold them into one, keeping the longer history.
  const map = new Map();
  for (const t of arr) {
    const k = t.a + "|" + t.b;
    const ex = map.get(k);
    if (!ex) { map.set(k, t); continue; }
    for (const m of t.msgs) if (!ex.msgs.some((x) => x.id === m.id)) ex.msgs.push(m);
    ex.msgs.sort((x, y) => (Number(x.ts) || 0) - (Number(y.ts) || 0));
    while (ex.msgs.length > DM_MSGS_MAX) ex.msgs.shift();
    for (const kk of Object.keys(t.r || {})) ex.r[kk] = Math.max(Number(ex.r[kk]) || 0, Number(t.r[kk]) || 0);
  }
  dmStore = [...map.values()];
  saveDm();
}
// The last thing either side said in a thread - the people list shows it as the
// row's subtitle, so it is built here rather than shipping whole threads.
function dmPreview(m) {
  if (!m) return "";
  if (m.t === "img") return m.caption ? m.caption.slice(0, 80) : "Photo";
  if (m.t === "voice") return "Voice message";
  return String(m.text || "").slice(0, 80);
}

/* Deleted-message archive: every deletion copies the message here before it
   leaves history, so the admin can still read what was said. This is the only
   record of a *self*-delete, which deliberately leaves no note in the room and
   is otherwise untraceable, and it survives the message's own author renaming
   or leaving. The region sits *below* the DM block (and therefore below every
   earlier region), in space no earlier version of this server ever wrote, so an
   already-populated production state needs no migration. Read access is gated
   on the admin connection (`getDeleted`); nothing else ever reads it.
   Layout: JSON of [{at, t, ts, from, uid, text, url, caption, dur, size, by,
   self}, ...] + NUL, newest first. */
const DEL_SIZE = 2 * 1024 * 1024;
const DEL_OFF = DM_OFF - DEL_SIZE;
// Records kept before the oldest are dropped. The region itself is the real
// cap - writeDeleted evicts until the blob fits.
const DEL_MAX = 2000;
function readDeleted() {
  let len = 0;
  while (DEL_OFF + len < DM_OFF && state[DEL_OFF + len] !== 0) len++;
  if (!len) return [];
  try {
    const a = JSON.parse(utf8Decode(state, DEL_OFF, len));
    return Array.isArray(a) ? a.filter((e) => e && typeof e === "object" && !e.dm) : [];
  } catch (e) { return []; }
}
function writeDeleted(arr) {
  state.fill(0, DEL_OFF, DM_OFF);
  const max = DM_OFF - DEL_OFF - 1;
  let b = utf8Encode(JSON.stringify(arr));
  while (b.length > max && arr.length > 1) { arr.pop(); b = utf8Encode(JSON.stringify(arr)); }
  for (let i = 0; i < b.length && i < max; i++) state[DEL_OFF + i] = b[i];
}
/* Build an archive record from a message. `m` may be the server's own copy or
   the snapshot the deleting client sent along (rows old enough to have aged out
   of the rolling history exist only in the history store), so every field is
   treated as untrusted and clamped here. `by` is whoever performed the delete. */
function deletedRecord(m, by) {
  const src = m && typeof m === "object" ? m : {};
  const rec = { at: Date.now(), t: src.t === "img" || src.t === "voice" ? src.t : "chat" };
  const ts = Number(src.ts);
  if (isFinite(ts) && ts > 0) rec.ts = ts;
  if (src.from) rec.from = String(src.from).slice(0, MAX_NAME);
  if (src.uid) rec.uid = String(src.uid).slice(0, 40);
  if (rec.t === "chat") {
    rec.text = String(src.text || "").slice(0, MAX_TEXT);
  } else {
    const url = String(src.url || "");
    if (url.indexOf("https://") === 0) rec.url = url.slice(0, 500);
    if (rec.t === "img") rec.caption = String(src.caption || "").slice(0, MAX_TEXT);
    else {
      const dur = Number(src.dur);
      rec.dur = isFinite(dur) ? Math.max(0, Math.min(600, Math.round(dur * 10) / 10)) : 0;
      rec.size = Math.max(0, Math.min(50 * 1024 * 1024, Number(src.size) || 0));
    }
  }
  if (by) rec.by = String(by).slice(0, MAX_NAME);
  return rec;
}
function archiveDeleted(rec) {
  if (!rec) return;
  const arr = readDeleted();
  arr.unshift(rec);
  while (arr.length > DEL_MAX) arr.pop();
  writeDeleted(arr);
}
function sha256Hex(s) {
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = s.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        i++;
      } else bytes.push(0xef, 0xbf, 0xbd);
    } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(Math.floor(bitLen / Math.pow(2, i * 8)) % 256);
  const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const W = new Array(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = ((W[i-15] >>> 7) | (W[i-15] << 25)) ^ ((W[i-15] >>> 18) | (W[i-15] << 14)) ^ (W[i-15] >>> 3);
      const s1 = ((W[i-2] >>> 17) | (W[i-2] << 15)) ^ ((W[i-2] >>> 19) | (W[i-2] << 13)) ^ (W[i-2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
}

function sanitizeReply(r) {
  if (!r || typeof r !== "object") return null;
  const out = { from: String(r.from || "").slice(0, MAX_NAME) };
  if (r.t === "img" && String(r.url || "").indexOf("https://") === 0) {
    out.t = "img";
    out.url = String(r.url).slice(0, 500);
  } else if (r.t === "voice") {
    out.t = "voice";
    const dur = Number(r.dur);
    out.dur = isFinite(dur) ? Math.max(0, Math.min(600, Math.round(dur * 10) / 10)) : 0;
    out.size = Math.max(0, Math.min(50 * 1024 * 1024, Number(r.size) || 0));
  } else {
    out.t = "chat";
    let text = String(r.text || "").trim();
    if (!text) return null;
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
    out.text = text;
  }
  out.id = String(r.id || "").slice(0, 64);
  return out;
}

function presenceNames() {
  const names = new Set();
  for (const cc of conns.values()) {
    if (!cc.name || !cc.named) continue;
    if (adminHidden && cc.name === ADMIN_NAME) continue;
    if (blockedInRegion(cc.name, cc.country) || proxyBlocked(cc)) continue;
    names.add(cc.name);
  }
  for (const f of fakePresence) names.add(f);
  return names;
}
function publishPresence() {
  pubsub.publish(ROOM, JSON.stringify({ t: "presence", count: presenceNames().size }));
}
function publishSystem(text) { pubsub.publish(ROOM, JSON.stringify({ t: "system", text, ts: Date.now() })); }

// Log every live connection currently holding a protected name out of it and
// tell that client to log back in with the password. Used by the admin RPC and
// by the single-session rule in setName.
function logoutProtectedConns(skip, onlyName) {
  const now = Date.now();
  const kicked = [];
  for (const cc of conns.values()) {
    if (cc === skip || !cc.named) continue;
    const prot = protectedUser(cc.name);
    if (!prot) continue;
    if (onlyName && prot.name !== onlyName) continue;
    kicked.push(prot.name);
    cc.name = randomGuest();
    cc.named = false;
    cc.conn.send(JSON.stringify({ t: "protected_logout", name: prot.name, guest: cc.name, ts: now }));
  }
  if (kicked.length) publishPresence();
  return kicked;
}

self.onopen = ({ conn }) => {
  // Guarded, because a server rebuild can re-run `onopen` for a socket that is
  // still open (the browser gets no `open` event). Subscribing a connection to
  // the same topic twice would fan every room publish out to it twice - which
  // the client would draw as the same message appearing twice.
  if (!conn.isSubscribed(ROOM)) conn.subscribe(ROOM);
  const name = randomGuest();
  conns.set(conn.id, { conn, name, named: false, uid: "", loc: "", country: "", proxy: conn.isProxy === true, lastMsg: 0, lastTyping: 0, lastAct: 0 });
  conn.send(JSON.stringify({ t: "me", name }));
  // The VPN gate is deliberately NOT applied here: the connection has not
  // claimed a name yet, so the verified-user exemption cannot be evaluated, and
  // warning a verified user off before they identify would be wrong. `setName`
  // is the authoritative gate and still answers "vpn_blocked" to anyone who is
  // actually blocked.
  if (isBanned(null, conn.net[3])) conn.send(JSON.stringify({ t: "you_banned", ts: Date.now() }));
  publishPresence();
};

self.onmessage = ({ conn, data }) => {
  const c = conns.get(conn.id);
  if (!c) return;
  let m;
  try { m = JSON.parse(data); } catch (e) { return; }
  if (!m || typeof m.t !== "string") return;
  if (blockedInRegion(c.name, c.country) || proxyBlocked(c)) return;
  if (!c.named) return;
  const now = Date.now();
  const ts = Number(m.ts) || now;
  if ((m.t === "chat" || m.t === "img" || m.t === "voice" || m.t === "del" || m.t === "edit" || m.t === "dm") && isBanned(c.name, conn.net[3])) {
    c.conn.send(JSON.stringify({ t: "you_banned", ts: now }));
    return;
  }
  if (m.t === "chat" || m.t === "img" || m.t === "voice") {
    if (now - c.lastMsg < 200) return;
    c.lastMsg = now;
    const netLast = netMsgTimes.get(conn.net[3]) || 0;
    if (now - netLast < 80) return;
    netMsgTimes.set(conn.net[3], now);
    const replyTo = sanitizeReply(m.replyTo);
    if (m.t === "chat") {
      let text = String(m.text || "").trim();
      if (!text) return;
      if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
      const msg = { t: "chat", from: c.name, text, id: now + "-" + Math.floor(Math.random() * 1000), ts };
      if (c.uid) msg.uid = c.uid;
      if (replyTo) msg.replyTo = replyTo;
      addToHistory(JSON.stringify(msg));
      pubsub.publish(ROOM, JSON.stringify(msg));
    } else {
      const url = String(m.url || "").trim().slice(0, 500);
      if (url.indexOf("https://") !== 0) return;
      const msg = { t: m.t, from: c.name, url, id: now + "-" + Math.floor(Math.random() * 1000), ts };
      if (c.uid) msg.uid = c.uid;
      if (replyTo) msg.replyTo = replyTo;
      if (m.t === "img") {
        const cap = String(m.caption || "").trim().slice(0, MAX_TEXT);
        if (cap) msg.caption = cap;
      }
      if (m.t === "voice") {
        const dur = Number(m.dur);
        msg.dur = isFinite(dur) ? Math.max(0, Math.min(600, Math.round(dur * 10) / 10)) : 0;
        msg.size = Math.max(0, Math.min(50 * 1024 * 1024, Number(m.size) || 0));
      }
      addToHistory(JSON.stringify(msg));
      pubsub.publish(ROOM, JSON.stringify(msg));
    }
  } else if (m.t === "del") {
    const id = String(m.id || "");
    const tsHint = Number(m.ts) || null;
    const fromHint = m.from ? String(m.from).slice(0, MAX_NAME) : null;
    if ((!id && !fromHint) || now - c.lastAct < 50) return;
    c.lastAct = now;
    const admin = c.name === ADMIN_NAME;
    const tgt = id ? (findMsg(id) || findByTsFrom(fromHint, tsHint)) : findByTsFrom(fromHint, tsHint);
    const canonId = tgt ? tgt.id : (id || null);
    const from = tgt ? tgt.from : fromHint;
    const mts = tgt ? tgt.ts : tsHint;
    // Every deletion is archived (see the DEL region) *before* the message
    // leaves history, so a self-delete - which leaves no note and no other
    // trace - is still reviewable. The server's own copy wins; the snapshot the
    // deleting client sent along only fills in rows old enough to have aged out
    // of the server's rolling history.
    const snap = m.snap && typeof m.snap === "object" ? m.snap : null;
    const archSrc = tgt
      ? (tgt.t === "delnote" && tgt.orig ? Object.assign({ ts: tgt.ts, from: tgt.from, uid: tgt.uid }, tgt.orig) : tgt)
      : (snap ? { t: snap.t, text: snap.text, url: snap.url, caption: snap.caption, dur: snap.dur, size: snap.size, from: fromHint, ts: tsHint, uid: m.uid } : null);
    // Verified users moderate like the admin, with two differences: they can
    // never delete silently (their name always goes on the note), and they may
    // not touch the admin's or another verified user's message.
    const mod = admin || (isVerified(c.name, conn.net[3]) && !protectedName(from));
    if (msgOwnedBy(tgt, c, fromHint)) {
      const own = deletedRecord(archSrc, c.name);
      own.self = 1;
      archiveDeleted(own);
      if (canonId && tgt) removeFromHistory(canonId, null);
      pubsub.publish(ROOM, JSON.stringify({ t: "del", id: canonId || id, from, mts, ts: now }));
    } else if (mod) {
      if (m.silent && admin) {
        archiveDeleted(deletedRecord(archSrc, c.name));
        if (canonId && tgt) removeFromHistory(canonId, null);
        pubsub.publish(ROOM, JSON.stringify({ t: "del", id: canonId || id, from, mts, ts: now }));
      } else if (from && from !== ADMIN_NAME) {
        if (canonId && tgt) {
          if (tgt.t === "delnote") {
            if (!admin) return;
            removeFromHistory(canonId, null);
            pubsub.publish(ROOM, JSON.stringify({ t: "del", id: canonId, from, mts, ts: now }));
          } else {
            archiveDeleted(deletedRecord(archSrc, c.name));
            const orig = replaceWithDelNote(canonId, c.name);
            pubsub.publish(ROOM, JSON.stringify({ t: "delnote", id: canonId, from, mts, ts: now, orig, by: c.name }));
          }
        } else {
          archiveDeleted(deletedRecord(archSrc, c.name));
          pubsub.publish(ROOM, JSON.stringify({ t: "delnote", id: canonId || id, from, mts, ts: now, by: c.name }));
        }
      } else {
        if (!admin) return;
        archiveDeleted(deletedRecord(archSrc, c.name));
        if (canonId && tgt) removeFromHistory(canonId, null);
        pubsub.publish(ROOM, JSON.stringify({ t: "del", id: canonId || id, from, mts, ts: now }));
      }
    }
  } else if (m.t === "edit") {
    const id = String(m.id || "");
    let text = String(m.text || "").trim();
    const tsHint = Number(m.ts) || null;
    const fromHint = m.from ? String(m.from).slice(0, MAX_NAME) : null;
    if ((!id && !fromHint) || now - c.lastAct < 50) return;
    c.lastAct = now;
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
    const tgt = id ? (findMsg(id) || findByTsFrom(fromHint, tsHint)) : findByTsFrom(fromHint, tsHint);
    if (!msgOwnedBy(tgt, c, fromHint)) return;
    const canonId = tgt ? tgt.id : (id || null);
    if (canonId && tgt && !editMessage(canonId, null, text)) return;
    pubsub.publish(ROOM, JSON.stringify({ t: "edit", id: canonId || id, text, from: fromHint, mts: tgt ? tgt.ts : tsHint, ts: now }));
  } else if (m.t === "flag") {
    const id = String(m.id || "");
    const tsHint = Number(m.ts) || null;
    const fromHint = m.from ? String(m.from).slice(0, MAX_NAME) : null;
    if ((c.name !== ADMIN_NAME && !isVerified(c.name, conn.net[3])) || (!id && !fromHint) || now - c.lastAct < 50) return;
    c.lastAct = now;
    const tgt = id ? (findMsg(id) || findByTsFrom(fromHint, tsHint)) : findByTsFrom(fromHint, tsHint);
    if (c.name !== ADMIN_NAME && protectedName((tgt && tgt.from) || fromHint)) return;
    const canonId = tgt ? tgt.id : (id || null);
    let flagged = null;
    if (canonId && tgt) flagged = toggleFlag(canonId);
    if (flagged === null) flagged = !!m.to;
    pubsub.publish(ROOM, JSON.stringify({ t: "flag", id: canonId || id, flagged, from: fromHint, mts: tsHint, ts: now }));
  } else if (m.t === "react") {
    const id = String(m.id || "");
    const tsHint = Number(m.ts) || null;
    const fromHint = m.from ? String(m.from).slice(0, MAX_NAME) : null;
    const emoji = String(m.emoji || "").slice(0, 48);
    if (!isEmoji(emoji)) return;
    if (!id && !fromHint) return;
    if (now - c.lastAct < 40) return;
    c.lastAct = now;
    const tgt = id ? (findMsg(id) || findByTsFrom(fromHint, tsHint)) : findByTsFrom(fromHint, tsHint);
    if (tgt && tgt.t === "delnote") return;
    const from = tgt ? tgt.from : fromHint;
    const mts = tgt ? tgt.ts : tsHint;
    const who = rxIdentity(c);
    noteReactorName(who, c.name);
    const rx = toggleReaction(from, mts, who, emoji);
    if (rx === null) {
      // No author/timestamp to key on, so the reaction can't be stored.
      c.conn.send(JSON.stringify({ t: "rx_fail", ts: now }));
      return;
    }
    pubsub.publish(ROOM, JSON.stringify({ t: "react", id: (tgt && tgt.id) || id || null, from, mts, rx, nm: rxNamesFor(rx), ts: now }));
  } else if (m.t === "sysmsg") {
    if (c.name !== ADMIN_NAME) return;
    const text = String(m.text || "").trim().slice(0, 100);
    if (!text) return;
    const nm = text.replace(/\s+(joined|left)$/, "").trim();
    if (m.presence === "join") {
      if (nm) { fakePresence.add(nm); knownFake.add(nm); }
      if (nm === ADMIN_NAME) adminHidden = false;
    } else if (m.presence === "left") {
      if (nm) { fakePresence.delete(nm); knownFake.delete(nm); }
      if (nm === ADMIN_NAME) adminHidden = true;
    }
    persistFakeUsers();
    pubsub.publish(ROOM, JSON.stringify({ t: "system", text, ts: now }));
    publishPresence();
  } else if (m.t === "typing") {
    if (now - c.lastTyping < 2000) return;
    c.lastTyping = now;
    pubsub.publish(ROOM, JSON.stringify({ t: "typing", from: c.name, uid: c.uid || "" }));
  } else if (m.t === "dm") {
    // Only a verified user (or the admin) has private chats at all, and only a
    // verified user can be reached by one.
    if (!mayDm(c.name, conn.net[3])) return;
    const to = String(m.to || "").trim().slice(0, MAX_NAME);
    if (!to || !nameValid(to) || to === c.name) return;
    if (!dmName(to)) return;
    const ev = String(m.ev || "");
    const sub = String(m.sub || "chat");
    if (ev) {
      if (now - c.lastAct < 50) return;
      c.lastAct = now;
    } else {
      if (sub !== "chat" && sub !== "img" && sub !== "voice") return;
      // The room's anti-flood budget, applied per conversation.
      if (now - c.lastMsg < 200) return;
      c.lastMsg = now;
      const netLast = netMsgTimes.get(conn.net[3]) || 0;
      if (now - netLast < 80) return;
      netMsgTimes.set(conn.net[3], now);
    }
    // Read receipts and typing notices must not conjure an empty thread.
    const t = dmThread(c.name, to, ev !== "read" && ev !== "typing");
    if (!t) return;
    if (ev === "read") {
      t.r = t.r || {};
      t.r[c.name] = now;
      saveDm();
      dmDeliver(to, { t: "dm", peer: c.name, ev: "read", ts: now });
      return;
    }
    if (ev === "typing") {
      if (now - c.lastTyping < 2000) return;
      c.lastTyping = now;
      dmDeliver(to, { t: "dm", peer: c.name, ev: "typing" });
      return;
    }
    const id = String(m.id || "").slice(0, 64);
    const rec = id ? t.msgs.find((x) => x.id === id) : null;
    if (ev === "del") {
      if (!rec || rec.from !== c.name) return;
      t.msgs = t.msgs.filter((x) => x.id !== rec.id);
      saveDm();
      const payload = { t: "dm", ev: "del", id: rec.id, from: c.name, ts: now };
      dmDeliver(to, Object.assign({}, payload, { peer: c.name }));
      dmDeliver(c.name, Object.assign({}, payload, { peer: to }));
      return;
    }
    if (ev === "edit") {
      if (!rec || rec.from !== c.name || rec.t !== "chat") return;
      const text = String(m.text || "").trim().slice(0, MAX_TEXT);
      if (!text) return;
      rec.text = text;
      saveDm();
      const payload = { t: "dm", ev: "edit", id: rec.id, from: c.name, text, ts: now };
      dmDeliver(to, Object.assign({}, payload, { peer: c.name }));
      dmDeliver(c.name, Object.assign({}, payload, { peer: to }));
      return;
    }
    if (ev === "react") {
      // Reactions live in the shared author+timestamp store, so they need no
      // per-thread storage - but a private one is aimed at the two participants
      // instead of the room's topic, so nothing about it leaks to the room.
      const emoji = String(m.emoji || "").slice(0, 48);
      if (!rec || !isEmoji(emoji)) return;
      const who = rxIdentity(c);
      noteReactorName(who, c.name);
      const rx = toggleReaction(rec.from, rec.ts, who, emoji);
      if (rx === null) return;
      const payload = { t: "dm", peer: c.name, ev: "react", id: rec.id, from: rec.from, mts: rec.ts, rx, nm: rxNamesFor(rx), ts: now };
      dmDeliver(to, payload);
      dmDeliver(c.name, Object.assign({}, payload, { peer: to }));
      return;
    }
    if (ev) return;
    const msg = { t: sub, from: c.name, ts, id: "d" + now + "-" + Math.floor(Math.random() * 1000) };
    if (c.uid) msg.uid = c.uid;
    if (sub === "chat") {
      msg.text = String(m.text || "").trim().slice(0, MAX_TEXT);
      if (!msg.text) return;
    } else {
      const url = String(m.url || "").trim().slice(0, 500);
      if (url.indexOf("https://") !== 0) return;
      msg.url = url;
      if (sub === "img") {
        const cap = String(m.caption || "").trim().slice(0, MAX_TEXT);
        if (cap) msg.caption = cap;
      } else {
        const d = Number(m.dur);
        msg.dur = isFinite(d) ? Math.max(0, Math.min(600, Math.round(d * 10) / 10)) : 0;
        msg.size = Math.max(0, Math.min(50 * 1024 * 1024, Number(m.size) || 0));
      }
    }
    const replyTo = sanitizeReply(m.replyTo);
    if (replyTo) msg.replyTo = replyTo;
    t.msgs.push(msg);
    while (t.msgs.length > DM_MSGS_MAX) t.msgs.shift();
    // Sending is reading: your own read mark moves forward with your message.
    t.r = t.r || {};
    t.r[c.name] = now;
    saveDm();
    // Each side gets a copy stamped with the *other* party as `peer`, so both
    // clients can render in/out bubbles and know which thread it belongs to
    // without the sender's own name being trusted to travel. The envelope `t`
    // is "dm" (that is what routes it); the content kind rides in `sub`.
    dmDeliver(to, Object.assign({}, msg, { t: "dm", sub, peer: c.name }));
    dmDeliver(c.name, Object.assign({}, msg, { t: "dm", sub, peer: to }));
  }
};

self.onclose = ({ conn }) => {
  const c = conns.get(conn.id);
  if (!c) return;
  conns.delete(conn.id);
  if (c.name === ADMIN_NAME) adminHidden = false;
  netMsgTimes.delete(conn.net[3]);
  publishPresence();
  if (c.named) publishSystem(c.name + " left");
};

self.rpc = {
  reportLoc({ conn }, data) {
    const c = conns.get(conn.id);
    if (!c) return "err";
    let loc = "";
    try {
      const parsed = JSON.parse(data);
      loc = String((parsed && parsed.loc) || "").trim().slice(0, 120);
    } catch (e) {
      loc = String(data || "").trim().slice(0, 120);
    }
    c.loc = loc;
    c.country = regionOf(loc);
    return "ok";
  },
  getHistory({ conn }) {
    return readHistory(readBans());
  },
  getBanned({ conn }) {
    return JSON.stringify(readBans().map((b) => b.name));
  },
  // Reactions for every message anyone has reacted to, so a freshly loaded
  // client can paint them onto rows it renders from the history store.
  getReactions({ conn }) {
    const store = loadRx();
    const out = [];
    for (const e of store.values()) if (e.rx && Object.keys(e.rx).length) out.push({ from: e.f, ts: e.t, rx: e.rx, nm: rxNamesFor(e.rx) });
    return JSON.stringify(out);
  },
  getTitle({ conn }) {
    return readTitle();
  },
  setTitle({ conn }, data) {
    const c = conns.get(conn.id);
    if (!c || c.name !== ADMIN_NAME) return "admin only";
    let t = String(data || "").trim().slice(0, TITLE_MAX);
    if (!t) return "invalid";
    writeTitle(t);
    pubsub.publish(ROOM, JSON.stringify({ t: "title", title: t, ts: Date.now() }));
    return "ok";
  },
  getIcon({ conn }) {
    return readIcon();
  },
  getOnline({ conn }) {
    const c = conns.get(conn.id);
    if (!c) return "err";
    const isAdmin = c.name === ADMIN_NAME;
    const counts = new Map();
    const locs = new Map();
    const prox = new Map();
    for (const cc of conns.values()) {
      if (!cc.name || !cc.named) continue;
      if (adminHidden && cc.name === ADMIN_NAME) continue;
      if (blockedInRegion(cc.name, cc.country) || proxyBlocked(cc)) continue;
      counts.set(cc.name, (counts.get(cc.name) || 0) + 1);
      if (cc.loc && !locs.has(cc.name)) locs.set(cc.name, cc.loc);
      if (cc.conn.isProxy) prox.set(cc.name, 1);
    }
    const list = [];
    for (const [name, count] of counts) {
      const entry = { name, count };
      if (isAdmin && locs.get(name)) entry.loc = locs.get(name);
      if (isAdmin && prox.get(name)) entry.proxy = 1;
      list.push(entry);
    }
    for (const f of fakePresence) {
      if (counts.has(f)) continue;
      list.push({ name: f, count: 1 });
    }
    return JSON.stringify(list);
  },
  getNetworks({ conn }) {
    const c = conns.get(conn.id);
    if (!c || c.name !== ADMIN_NAME) return "admin only";
    const list = [];
    for (const cc of conns.values()) {
      if (!cc.name) continue;
      if (adminHidden && cc.name === ADMIN_NAME) continue;
      if (blockedInRegion(cc.name, cc.country)) continue;
      const n = cc.conn.net;
      list.push({
        name: cc.name,
        loc: cc.loc || "",
        online: 1,
        isProxy: cc.conn.isProxy ? 1 : 0,
        net: [n[0], n[1], n[2], n[3]]
      });
    }
    for (const f of fakePresence) {
      if (list.some((e) => e.name === f)) continue;
      list.push({ name: f, loc: "", online: 1, isProxy: 0, net: [] });
    }
    return JSON.stringify(list);
  },
  setIcon({ conn }, data) {
    const c = conns.get(conn.id);
    if (!c || c.name !== ADMIN_NAME) return "admin only";
    let u = String(data || "").trim().slice(0, ICON_MAX);
    if (u && u.indexOf("https://") !== 0) return "invalid";
    writeIcon(u);
    pubsub.publish(ROOM, JSON.stringify({ t: "icon", url: u, ts: Date.now() }));
    return "ok";
  },
  setName({ conn }, data) {
    const c = conns.get(conn.id);
    if (!c) return "err";
    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed;
      } catch (e) {}
    }
    let name = "";
    let pass = "";
    if (data && typeof data === "object") {
      name = String(data.name || "").trim();
      pass = String(data.password || "");
    } else {
      name = String(data || "").trim();
    }
    name = name.slice(0, MAX_NAME);
    if (!name) name = randomGuest(conn);
    if (nameHasBlacklisted(name)) return "blocked_word";
    if (!nameValid(name)) return "invalid";
    const uid = String((data && data.uid) || "").trim();
    if (uidValid(uid)) c.uid = uid;
    c.loc = String((data && data.loc) || "").trim().slice(0, 120);
    c.country = regionOf(c.loc);
    // Claims the name -> test *that* name against the verified exemption.
    if (proxyBlocked(c, name) && name !== ADMIN_NAME) return "vpn_blocked";
    if (/^admin$/i.test(name)) {
      name = ADMIN_NAME;
      const nowT = Date.now();
      const rec = adminAttempts.get(conn.net[3]);
      const tries = rec && nowT - rec.t < 60000 ? rec.count : 0;
      if (tries >= 5) return "too_many_attempts";
      if (!pass) return "password_required";
      if (sha256Hex(pass) !== ADMIN_HASH) {
        adminAttempts.set(conn.net[3], { count: tries + 1, t: nowT });
        return "wrong_password";
      }
      adminAttempts.delete(conn.net[3]);
    }
    const prot = protectedUser(name);
    if (prot) {
      name = prot.name;
      const nowT = Date.now();
      const key = conn.net[3] + "|" + prot.name;
      const rec = protectedAttempts.get(key);
      const tries = rec && nowT - rec.t < 60000 ? rec.count : 0;
      if (tries >= 5) return "too_many_attempts";
      if (!pass) return "password_required";
      if (hashPass(pass, prot.salt) !== prot.hash) {
        protectedAttempts.set(key, { count: tries + 1, t: nowT });
        return "wrong_password";
      }
      protectedAttempts.delete(key);
    }
    // A protected identity is single-session: logging in with the password
    // kicks any other live connection still holding that name, so a stale
    // session can't keep squatting it.
    if (prot) logoutProtectedConns(c, prot.name);
    if (name !== ADMIN_NAME && isBanned(name, conn.net[3])) return "banned";
    if (blockedInRegion(name, c.country)) return "unavailable_region";
    // A name already held by a different live person is refused rather than
    // silently shared (the admin and password-protected names are handled above).
    if (!prot && name !== ADMIN_NAME && name !== c.name && nameTaken(name, conn, c.uid)) return "name_taken";
    // `pfp` is optional and only applied when the client actually sends the
    // field: "" removes the picture, an https URL sets it. It rides along with
    // setName so a brand-new joiner can upload a picture and pick a name in one
    // round trip - the server is the one that decides whether the URL is real.
    const hasPfpField = !!(data && typeof data === "object" && typeof data.pfp === "string");
    let pfpChanged = false;
    if (name !== c.name) {
      const old = c.name;
      c.name = name;
      renameProfilePfp(old, name);
      dmRename(old, name);
      pfpChanged = true;
      if (c.uid) noteReactorName("u:" + c.uid, name);
      if (!c.named) {
        c.named = true;
        publishSystem(name + " joined");
      } else if (old !== ADMIN_NAME && name !== ADMIN_NAME) {
        renameInHistory(old, name, c.uid);
        renameReactions(old, name);
        pubsub.publish(ROOM, JSON.stringify({ t: "rename", from: old, to: name, uid: c.uid || "", ts: Date.now() }));
        publishSystem(old + " is now " + name);
      }
      publishPresence();
    }
    if (hasPfpField) {
      setProfilePfp(c.name, cleanPfpUrl(data.pfp));
      pfpChanged = true;
    }
    if (pfpChanged) publishPfp(c.name);
    return "ok";
  },
  fakeSay({ conn }, data) {
    const c = conns.get(conn.id);
    if (!c || c.name !== ADMIN_NAME) return "admin only";
    const now = Date.now();
    if (now - c.lastMsg < 200) return "rate limited";
    c.lastMsg = now;
    const netLast = netMsgTimes.get(conn.net[3]) || 0;
    if (now - netLast < 80) return "rate limited";
    netMsgTimes.set(conn.net[3], now);
    let d = {};
    try { d = JSON.parse(data); } catch (e) {}
    let name = String(d.name || "").trim().slice(0, MAX_NAME);
    let text = String(d.text || "").trim();
    if (!nameValid(name) || nameHasBlacklisted(name) || name === ADMIN_NAME) return "invalid";
    if (!text) return "invalid";
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
    fakePresence.add(name);
    knownFake.add(name);
    persistFakeUsers();
    const msg = { t: "chat", from: name, text, id: now + "-" + Math.floor(Math.random() * 1000), ts: now };
    addToHistory(JSON.stringify(msg));
    pubsub.publish(ROOM, JSON.stringify(msg));
    publishPresence();
    return "ok";
  },
  getFakeUsers({ conn }) {
    const c = conns.get(conn.id);
    if (!c || c.name !== ADMIN_NAME) return "admin only";
    return JSON.stringify([...knownFake]);
  },
  clearAll({ conn }) {
    const c = conns.get(conn.id);
    if (!c || c.name !== ADMIN_NAME) return "admin only";
    const now = Date.now();
    const last = lastClearTimes.get(conn.net[3]) || 0;
    if (now - last < 5000) return "rate limited";
    lastClearTimes.set(conn.net[3], now);
    const bans = readBans();
    const title = readTitle();
    const icon = readIcon();
    const pfps = readPfps();
    const deleted = readDeleted();
    state.fill(0);
    rxStore = null;
    if (bans.length) writeBans(bans);
    if (title) writeTitle(title);
    if (icon) writeIcon(icon);
    if (pfps.length) writePfps(pfps);
    writeDeleted(deleted);
    persistFakeUsers();
    pubsub.publish(ROOM, JSON.stringify({ t: "clear", ts: now }));
    return "ok";
  },
  clearState({ conn }) {
    const c = conns.get(conn.id);
    if (!c || c.name !== ADMIN_NAME) return "admin only";
    const bans = readBans();
    const title = readTitle();
    const icon = readIcon();
    const pfps = readPfps();
    const deleted = readDeleted();
    state.fill(0);
    rxStore = null;
    if (bans.length) writeBans(bans);
    if (title) writeTitle(title);
    if (icon) writeIcon(icon);
    if (pfps.length) writePfps(pfps);
    writeDeleted(deleted);
    persistFakeUsers();
    return "ok";
  },
  banUser({ conn }, data) {
    const c = conns.get(conn.id);
    if (!c || (c.name !== ADMIN_NAME && !isVerified(c.name, conn.net[3]))) return "admin only";
    let d = {};
    try { d = JSON.parse(data); } catch (e) {}
    const target = String(d.name || "").trim().slice(0, MAX_NAME);
    if (!target || target === ADMIN_NAME) return "invalid";
    let targetNet = (typeof d.net === "number") ? d.net : null;
    for (const cc of conns.values()) if (cc.name === target && targetNet == null) targetNet = cc.conn.net[3];
    if (c.name !== ADMIN_NAME && protectedName(target)) return "protected";
    const bans = readBans();
    if (bans.some((r) => (r.name && r.name === target) || (targetNet != null && r.net === targetNet))) return "already banned";
    bans.push({ name: target, net: targetNet });
    writeBans(bans);
    fakePresence.delete(target);
    const now = Date.now();
    for (const cc of conns.values()) {
      if (cc.name === target) cc.conn.send(JSON.stringify({ t: "you_banned", ts: now }));
    }
    publishSystem(target + " was banned");
    pubsub.publish(ROOM, JSON.stringify({ t: "ban", name: target, ts: now }));
    publishPresence();
    return "ok";
  },
  unbanUser({ conn }, data) {
    const c = conns.get(conn.id);
    if (!c || (c.name !== ADMIN_NAME && !isVerified(c.name, conn.net[3]))) return "admin only";
    let d = {};
    try { d = JSON.parse(data); } catch (e) {}
    const target = String(d.name || "").trim().slice(0, MAX_NAME);
    if (!target) return "invalid";
    let targetNet = (typeof d.net === "number") ? d.net : null;
    if (c.name !== ADMIN_NAME && protectedName(target)) return "protected";
    const bans = readBans().filter((r) => !(r.name === target || (targetNet != null && r.net === targetNet)));
    writeBans(bans);
    if (knownFake.has(target)) {
      fakePresence.add(target);
      publishPresence();
    }
    pubsub.publish(ROOM, JSON.stringify({ t: "unban", name: target, ts: Date.now() }));
    return "ok";
  },
  getVerified({ conn }) {
    return JSON.stringify(readVerifiedNames());
  },
  // Every known nickname -> picture URL, so a freshly loaded client can draw
  // avatars for the whole history without waiting to see those people connect.
  getPfps({ conn }) {
    const obj = {};
    for (const e of readPfps()) obj[e.name] = e.url;
    return JSON.stringify(obj);
  },
  // The people list: one entry per conversation, each with the preview line and
  // unread count its row needs. Only the last message travels, never a thread.
  // Private chat is a verified-user feature, so an unverified caller gets
  // nothing and only verified peers are ever listed.
  getDmThreads({ conn }) {
    const c = conns.get(conn.id);
    if (!c || !c.named || !mayDm(c.name, conn.net[3])) return "[]";
    const out = [];
    for (const t of dmThreadsFor(c.name)) {
      const peer = dmPeerOf(t, c.name);
      if (!dmName(peer)) continue;
      const last = t.msgs.length ? t.msgs[t.msgs.length - 1] : null;
      out.push({
        peer,
        ts: dmLastTs(t),
        unread: dmUnread(t, c.name),
        from: last ? last.from : "",
        preview: dmPreview(last),
        read: Number(t.r && t.r[peer]) || 0
      });
    }
    out.sort((x, y) => y.ts - x.ts);
    return JSON.stringify(out);
  },
  // Opening a conversation reads it: this returns its messages plus the other
  // side's read mark (for the Seen tick), and tells the other side that theirs
  // just moved - which is also what paints their ticks.
  getDm({ conn }, data) {
    const c = conns.get(conn.id);
    if (!c || !c.named || !mayDm(c.name, conn.net[3])) return "{}";
    let peer = "";
    try { peer = String((JSON.parse(data) || {}).peer || ""); } catch (e) { peer = String(data || ""); }
    peer = peer.trim().slice(0, MAX_NAME);
    if (!peer || !nameValid(peer) || peer === c.name || !dmName(peer)) return "{}";
    const t = dmThread(c.name, peer, false);
    if (!t) return JSON.stringify({ peer, msgs: [], read: 0 });
    t.r = t.r || {};
    t.r[c.name] = Date.now();
    saveDm();
    dmDeliver(peer, { t: "dm", peer: c.name, ev: "read", ts: t.r[c.name] });
    return JSON.stringify({ peer, msgs: t.msgs, read: Number(t.r[peer]) || 0 });
  },
  // Deletes a whole conversation for both sides (the only way one goes away).
  dmDelete({ conn }, data) {
    const c = conns.get(conn.id);
    if (!c || !c.named || !mayDm(c.name, conn.net[3])) return "err";
    let peer = "";
    try { peer = String((JSON.parse(data) || {}).peer || ""); } catch (e) { peer = String(data || ""); }
    peer = peer.trim().slice(0, MAX_NAME);
    if (!peer || !nameValid(peer) || peer === c.name || !dmName(peer)) return "invalid";
    const [a, b] = dmPair(c.name, peer);
    const before = readDm().length;
    dmStore = readDm().filter((t) => !(t.a === a && t.b === b));
    saveDm();
    dmDeliver(peer, { t: "dm", peer: c.name, ev: "delete", ts: Date.now() });
    return before === dmStore.length ? "missing" : "ok";
  },
  /* Admin moderation of private chats. The admin is not a participant in these
     threads, so `mayDm`/`dmName` never apply here: every one of these is gated
     on the admin connection alone. Reads hand back the server's copy (capped at
     DM_MSGS_MAX per thread); the client merges the Supabase scrollback for the
     rest of the history and mirrors every removal there itself, because the
     server cannot reach Supabase - without that a deleted message would come
     straight back the next time a participant reopened the conversation. Each
     removal is relayed to both participants so their open thread updates live. */
  adminDmThreads({ conn }) {
    const c = conns.get(conn.id);
    if (!c || c.name !== ADMIN_NAME) return "[]";
    const out = [];
    for (const t of readDm()) {
      const last = t.msgs && t.msgs.length ? t.msgs[t.msgs.length - 1] : null;
      out.push({ a: t.a, b: t.b, ts: dmLastTs(t), count: t.msgs.length, from: last ? last.from : "", preview: dmPreview(last) });
    }
    out.sort((x, y) => y.ts - x.ts);
    return JSON.stringify(out);
  },
  adminDm({ conn }, data) {
    const c = conns.get(conn.id);
    if (!c || c.name !== ADMIN_NAME) return "{}";
    const pair = dmAdminPair(data);
    if (!pair) return "{}";
    const t = dmThread(pair[0], pair[1], false);
    return JSON.stringify({ a: t ? t.a : pair[0], b: t ? t.b : pair[1], msgs: t ? t.msgs : [] });
  },
  adminDmDeleteMsg({ conn }, data) {
    const c = conns.get(conn.id);
    if (!c || c.name !== ADMIN_NAME) return "admin only";
    let d = {};
    try { d = JSON.parse(data) || {}; } catch (e) { return "invalid"; }
    const pair = dmAdminPair(data);
    const id = String(d.id || "").slice(0, 64);
    if (!pair || !id) return "invalid";
    const t = dmThread(pair[0], pair[1], false);
    if (!t) return "missing";
    const rec = t.msgs.find((x) => x.id === id);
    if (!rec) return "missing";
    t.msgs = t.msgs.filter((x) => x.id !== rec.id);
    saveDm();
    const payload = { t: "dm", ev: "del", id: rec.id, from: rec.from, ts: Date.now() };
    dmDeliver(t.a, Object.assign({}, payload, { peer: t.b }));
    dmDeliver(t.b, Object.assign({}, payload, { peer: t.a }));
    return "ok";
  },
  adminDmDeleteAll({ conn }, data) {
    const c = conns.get(conn.id);
    if (!c || c.name !== ADMIN_NAME) return "admin only";
    const pair = dmAdminPair(data);
    if (!pair) return "invalid";
    const [x, y] = pair;
    const before = readDm().length;
    dmStore = readDm().filter((t) => !(t.a === x && t.b === y));
    saveDm();
    if (dmStore.length === before) return "missing";
    dmDeliver(x, { t: "dm", peer: y, ev: "delete", ts: Date.now() });
    dmDeliver(y, { t: "dm", peer: x, ev: "delete", ts: Date.now() });
    return "ok";
  },
  // The admin-only deleted-message archive (see the DEL region). Nobody else
  // can read it and there is no per-user view of it.
  getDeleted({ conn }) {
    const c = conns.get(conn.id);
    if (!c || c.name !== ADMIN_NAME) return "[]";
    return JSON.stringify(readDeleted());
  },
  clearDeleted({ conn }) {
    const c = conns.get(conn.id);
    if (!c || c.name !== ADMIN_NAME) return "admin only";
    writeDeleted([]);
    return "ok";
  },
  // Backfill door: deletions from before the archive existed still sit in the
  // history store as `delnote` rows carrying the original message, so the admin
  // client hands them over once. Merged by (from, ts), so re-importing is a
  // no-op. Admin-only: a hostile caller could at worst add junk to a log the
  // admin already reads, and nothing here can ever un-archive a message.
  importDeleted({ conn }, data) {
    const c = conns.get(conn.id);
    if (!c || c.name !== ADMIN_NAME) return "admin only";
    let list = [];
    try { list = JSON.parse(data); } catch (e) { return "[]"; }
    if (!Array.isArray(list)) return "[]";
    const arr = readDeleted();
    const seen = new Set();
    for (const e of arr) if (e && e.from && e.ts != null) seen.add(e.from + "|" + e.ts);
    let added = 0;
    for (const raw of list.slice(0, DEL_MAX)) {
      const rec = deletedRecord(raw, raw && raw.by);
      if (!rec.from || rec.ts == null) continue;
      const key = rec.from + "|" + rec.ts;
      if (seen.has(key)) continue;
      seen.add(key);
      rec.at = rec.ts;
      arr.push(rec);
      added++;
    }
    while (arr.length > DEL_MAX) arr.pop();
    // Newest first, so the panel reads top-down like the chat does.
    arr.sort((x, y) => (Number(y.at) || 0) - (Number(x.at) || 0));
    writeDeleted(arr);
    return JSON.stringify({ added, total: arr.length });
  },
  verifyUser({ conn }, data) {
    const c = conns.get(conn.id);
    if (!c || c.name !== ADMIN_NAME) return "admin only";
    let d = {};
    try { d = JSON.parse(data); } catch (e) {}
    const target = String(d.name || "").trim().slice(0, MAX_NAME);
    if (!target || target === ADMIN_NAME) return "invalid";
    const arr = readVerified();
    if (arr.some((r) => r.name === target)) return "already";
    let net = null;
    for (const cc of conns.values()) if (cc.name === target) net = cc.conn.net[3];
    arr.push({ name: target, net });
    writeVerified(arr);
    pubsub.publish(ROOM, JSON.stringify({ t: "verified", name: target, ts: Date.now() }));
    return "ok";
  },
  unverifyUser({ conn }, data) {
    const c = conns.get(conn.id);
    if (!c || c.name !== ADMIN_NAME) return "admin only";
    let d = {};
    try { d = JSON.parse(data); } catch (e) {}
    const target = String(d.name || "").trim().slice(0, MAX_NAME);
    if (!target) return "invalid";
    writeVerified(readVerified().filter((r) => r.name !== target));
    pubsub.publish(ROOM, JSON.stringify({ t: "unverified", name: target, ts: Date.now() }));
    return "ok";
  },
  logoutProtected({ conn }) {
    const c = conns.get(conn.id);
    if (!c || c.name !== ADMIN_NAME) return "admin only";
    const names = logoutProtectedConns(null);
    if (names.length) publishSystem(names.join(" & ") + " logged out \u2014 password required");
    return JSON.stringify({ ok: true, names });
  }
};
