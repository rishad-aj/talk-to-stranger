"use strict";
const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const { build } = require("./export");
const { createEngine, UPLOAD_DIR } = require("./engine");
const SRC_PLUGIN = path.join(__dirname, "server", "plugin.js");
const PORT = Number(process.env.PORT || 3000);
const { bytes } = build();
console.log("exported client (" + bytes + " bytes)");
const engine = createEngine(fs.readFileSync(SRC_PLUGIN, "utf8"));
const app = express();
app.use(express.static(path.join(__dirname, "dist")));
app.use("/uploads", express.static(UPLOAD_DIR));
const CT_EXT = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
  "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/webm": ".weba",
  "video/mp4": ".mp4", "video/webm": ".webm"
};
app.post("/uploads", express.raw({ type: "*/*", limit: "55mb" }), (req, res) => {
  try {
    const ct = String(req.headers["content-type"] || "").split(";")[0].trim();
    const ext = CT_EXT[ct] || ".bin";
    const name = crypto.randomBytes(16).toString("hex") + ext;
    const buf = req.body && req.body.length ? Buffer.from(req.body) : null;
    if (!buf) return res.json({ url: "", size: 0, error: "empty_file" });
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    res.json({ url: "/uploads/" + name, size: buf.length, error: null });
  } catch (e) {
    res.json({ url: "", size: 0, error: "upload_failed" });
  }
});
app.get("/health", (req, res) => res.json({ ok: true }));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws, req) => {
  engine.sockets.add(ws);
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "x";
  const conn = engine.connect(ip, (msg) => ws.send(msg), false);
  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(String(raw)); } catch (e) { m = null; }
    if (m && typeof m === "object" && (m.rpc || m.send !== undefined)) {
      if (m.rpc) {
        engine.rpc(conn, String(m.rpc), m.data === undefined ? "" : m.data)
          .then((result) => ws.send(JSON.stringify({ id: m.id, result })))
          .catch((e) => ws.send(JSON.stringify({ id: m.id, error: String((e && e.message) || e) })));
      } else {
        engine.message(conn, String(m.send));
      }
      return;
    }
    engine.message(conn, String(raw));
  });
  ws.on("close", () => {
    engine.sockets.delete(ws);
    engine.close(conn);
  });
});
server.listen(PORT, () => console.log("chat-room listening on :" + PORT));
