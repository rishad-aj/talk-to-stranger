/* Admin login check. Compares sha256(password) with ADMIN_PASSWORD_HASH.
   Default hash = your current admin password hash, so your password keeps working.
   Set ADMIN_PASSWORD_HASH in Vercel env vars to change it (sha256 hex of new password). */
const crypto = require("crypto");
const DEFAULT_HASH = "ae06c26544ef3d6ae784659c3d88fb17fd8c84cdc95dc9659aa0b5a4d60ca58f";
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false }); return; }
  var body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  var pass = String((body && body.password) || "");
  if (!pass) { res.status(200).json({ ok: false }); return; }
  var want = process.env.ADMIN_PASSWORD_HASH || DEFAULT_HASH;
  var got = crypto.createHash("sha256").update(pass, "utf8").digest("hex");
  var ok = false;
  try {
    ok = want.length === got.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
  } catch (e) { ok = false; }
  res.status(200).json({ ok: ok });
};
