// Chat Room — Vercel serverless backend.
// Authoritative logic that used to live in the Perchance server-plugin:
// message posting (with ban checks), editing/deleting (ownership checks),
// and all admin actions (ban/unban/verify/unverify/title/icon/clear/flag).
//
// Security model (same as the old Perchance server):
//  - The admin password is never stored in plaintext — only its SHA-256 hash
//    lives here (public code, like before). A high-entropy password stays safe.
//  - To rotate the admin password: compute sha256(yourNewPassword) and replace
//    ADMIN_HASH below (or set the ADMIN_HASH env var and leave this as "").
//  - Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY (Vercel -> Settings -> Environment Variables).
//  - Normal chat inserts/reads go through this function (service role) while the
//    public anon key in index.html is used only for history reads + uploads.

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const ADMIN_HASH = process.env.ADMIN_HASH || "4b0cb7d092e40e08a3b89691888b63b1bc4ebf0352f9b49399b11845f1d09b38";

const MAX_TEXT = 500;
const MAX_NAME = 20;
const MAX_TITLE = 60;
const MAX_ICON = 500;

function sha256(s) {
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

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function sb(path, opts = {}) {
  const r = await fetch(SUPABASE_URL + path, {
    method: opts.method || "GET",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: "Bearer " + SERVICE_KEY,
      "content-type": "application/json",
      Prefer: opts.prefer || "return=minimal",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error("sb " + r.status + " " + txt.slice(0, 200));
  }
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("json")) return r.json();
  return null;
}

const loginAttempts = new Map();
function loginOk(password) {
  return sha256(String(password || "")) === ADMIN_HASH;
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const ip = (req.headers.get("x-forwarded-for") || "?").split(",")[0].trim();

    if (req.method === "GET" && url.searchParams.get("action") === "state") {
      const [title, icon, bans, verified] = await Promise.all([
        sb("/rest/v1/settings?key=eq.title&select=value"),
        sb("/rest/v1/settings?key=eq.icon&select=value"),
        sb("/rest/v1/bans?select=name"),
        sb("/rest/v1/verified?select=name"),
      ]);
      return json(200, {
        title: (title && title[0] && title[0].value) || "",
        icon: (icon && icon[0] && icon[0].value) || "",
        bans: (bans || []).map((b) => b.name),
        verified: (verified || []).map((v) => v.name),
      });
    }

    if (req.method !== "POST") return json(405, { error: "method" });
    const body = await req.json().catch(() => ({}));
    const action = body.action || "";

    if (action === "post") {
      const sender = String(body.sender || "").trim().slice(0, MAX_NAME);
      const type = String(body.type || "");
      if (!sender || !type) return json(400, { error: "invalid" });
      const banned = await sb("/rest/v1/bans?name=eq." + encodeURIComponent(sender) + "&select=name");
      if (banned && banned.length) return json(403, { error: "banned" });
      const row = { sender, type, ts: Number(body.ts) || Date.now(), flagged: false };
      if (type === "chat") {
        const text = String(body.text || "").trim().slice(0, MAX_TEXT);
        if (!text) return json(400, { error: "empty" });
        row.text = text;
      } else if (type === "img" || type === "voice") {
        const u = String(body.url || "").trim().slice(0, MAX_ICON);
        if (u.indexOf("https://") !== 0) return json(400, { error: "invalid url" });
        row.url = u;
        if (type === "img") {
          const cap = String(body.text || "").trim().slice(0, MAX_TEXT);
          if (cap) row.text = cap;
        } else {
          row.dur = Math.max(0, Math.min(600, Number(body.dur) || 0));
          row.size = Math.max(0, Math.min(50 * 1024 * 1024, Number(body.size) || 0));
        }
      } else return json(400, { error: "bad type" });
      if (body.reply_to) row.reply_to = String(body.reply_to).slice(0, 64);
      await sb("/rest/v1/messages", { method: "POST", body: row });
      return json(200, { ok: 1 });
    }

    if (action === "edit") {
      const id = Number(body.id);
      const sender = String(body.sender || "");
      if (!id || !sender) return json(400, { error: "invalid" });
      const rows = await sb("/rest/v1/messages?id=eq." + id + "&select=id,sender,type");
      const target = rows && rows[0];
      if (!target) return json(404, { error: "not found" });
      if (target.sender !== sender) return json(403, { error: "not yours" });
      if (target.type === "img") {
        const cap = String(body.text || "").trim().slice(0, MAX_TEXT);
        await sb("/rest/v1/messages?id=eq." + id, { method: "PATCH", body: { text: cap || null } });
      } else if (target.type === "chat") {
        const text = String(body.text || "").trim().slice(0, MAX_TEXT);
        if (!text) return json(400, { error: "empty" });
        await sb("/rest/v1/messages?id=eq." + id, { method: "PATCH", body: { text } });
      } else return json(400, { error: "bad type" });
      return json(200, { ok: 1 });
    }

    if (action === "delete") {
      const id = Number(body.id);
      if (!id) return json(400, { error: "invalid" });
      const rows = await sb("/rest/v1/messages?id=eq." + id + "&select=id,sender");
      const target = rows && rows[0];
      if (!target) return json(404, { error: "not found" });
      const claimed = String(body.sender || "");
      const adminOk = claimed === "admin" && body.password && loginOk(body.password);
      if (target.sender === claimed) {
        await sb("/rest/v1/messages?id=eq." + id, { method: "DELETE" });
        return json(200, { ok: 1 });
      }
      if (adminOk) {
        if (body.trace && target.sender !== "admin") {
          await sb("/rest/v1/messages?id=eq." + id, { method: "PATCH", body: { type: "delnote", text: null, url: null, dur: null, size: null } });
        } else {
          await sb("/rest/v1/messages?id=eq." + id, { method: "DELETE" });
        }
        return json(200, { ok: 1 });
      }
      return json(403, { error: "not yours" });
    }

    if (action === "login") {
      const now = Date.now();
      const rec = loginAttempts.get(ip);
      const tries = rec && now - rec.t < 60000 ? rec.count : 0;
      if (tries >= 5) return json(429, { error: "too_many_attempts" });
      if (loginOk(body.password)) { loginAttempts.delete(ip); return json(200, { ok: 1 }); }
      loginAttempts.set(ip, { count: tries + 1, t: now });
      return json(403, { error: "wrong_password", attempts: tries + 1 });
    }

    if (action === "ban" || action === "unban" || action === "verify" || action === "unverify") {
      if (!loginOk(body.password)) return json(403, { error: "admin only" });
      const name = String(body.name || "").trim().slice(0, MAX_NAME);
      if (!name || name === "admin") return json(400, { error: "invalid" });
      const set = !!body.set;
      if (action === "ban" || action === "unban") {
        if (set) await sb("/rest/v1/bans", { method: "POST", body: { name, ts: Date.now(), by: "admin" } }).catch(() => {});
        else await sb("/rest/v1/bans?name=eq." + encodeURIComponent(name), { method: "DELETE" }).catch(() => {});
      } else {
        if (set) await sb("/rest/v1/verified", { method: "POST", body: { name, ts: Date.now() } }).catch(() => {});
        else await sb("/rest/v1/verified?name=eq." + encodeURIComponent(name), { method: "DELETE" }).catch(() => {});
      }
      return json(200, { ok: 1 });
    }

    if (action === "setTitle") {
      if (!loginOk(body.password)) return json(403, { error: "admin only" });
      const v = String(body.value || "").trim().slice(0, MAX_TITLE);
      if (!v) return json(400, { error: "invalid" });
      await sb("/rest/v1/settings?key=eq.title", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { key: "title", value: v } });
      return json(200, { ok: 1 });
    }

    if (action === "setIcon") {
      if (!loginOk(body.password)) return json(403, { error: "admin only" });
      const v = String(body.value || "").trim().slice(0, MAX_ICON);
      if (v && v.indexOf("https://") !== 0) return json(400, { error: "invalid" });
      await sb("/rest/v1/settings?key=eq.icon", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { key: "icon", value: v } });
      return json(200, { ok: 1 });
    }

    if (action === "clear") {
      if (!loginOk(body.password)) return json(403, { error: "admin only" });
      await sb("/rest/v1/messages", { method: "DELETE" });
      return json(200, { ok: 1 });
    }

    if (action === "flag") {
      if (!loginOk(body.password)) return json(403, { error: "admin only" });
      const id = Number(body.id);
      if (!id) return json(400, { error: "invalid" });
      const rows = await sb("/rest/v1/messages?id=eq." + id + "&select=id,flagged");
      const target = rows && rows[0];
      if (!target) return json(404, { error: "not found" });
      await sb("/rest/v1/messages?id=eq." + id, { method: "PATCH", body: { flagged: !target.flagged } });
      return json(200, { ok: 1, flagged: !target.flagged });
    }

    if (action === "preview") {
      const u = String(body.url || "").trim();
      if (!/^https?:\/\//i.test(u)) return json(400, { error: "bad url" });
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 6000);
        const r = await fetch(u, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; LinkPreview/1.0)" } });
        clearTimeout(to);
        const html = await r.text();
        const og = (p) => {
          const m = html.match(new RegExp('<meta[^>]+(?:property|name)="' + p + '"[^>]+content="([^"]*)"', "i")) ||
                    html.match(new RegExp('<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="' + p + '"', "i"));
          return m ? String(m[1]).replace(/&amp;/g, "&") : "";
        };
        const title = og("og:title") || ((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "");
        const desc = og("og:description");
        const img = og("og:image") || og("twitter:image");
        let host = u;
        try { host = new URL(u).host; } catch (e) {}
        return json(200, { title: title.trim().slice(0, 200), desc: desc.slice(0, 300), img, host });
      } catch (e) { return json(200, {}); }
    }

    return json(400, { error: "unknown action" });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
}
