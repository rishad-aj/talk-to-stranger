"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const STATE_BYTES = 50 * 1024 * 1024;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "state.bin");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
for (const d of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(d, { recursive: true });
function loadState() {
  let buf = Buffer.alloc(STATE_BYTES);
  try {
    const st = fs.statSync(STATE_FILE);
    if (st.size === STATE_BYTES) {
      const fd = fs.openSync(STATE_FILE, "r");
      fs.readSync(fd, buf, 0, STATE_BYTES, 0);
      fs.closeSync(fd);
    }
  } catch (e) {}
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
const state = loadState();
let dirty = false;
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  try {
    fs.writeFileSync(STATE_FILE, Buffer.from(state.buffer, state.byteOffset, state.byteLength));
  } catch (e) {}
}, 5000);
function hashStr(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  return [h1 >>> 0, h2 >>> 0];
}
function netForIp(ip) {
  const lan = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])|::1|fc|fd)/.test(ip || "");
  const [a, b] = hashStr(String(ip || "x") + "|n");
  const [c, d] = hashStr(String(ip || "x") + "|m");
  return lan ? [a, b, c, d] : [a ^ 0x9e37, b ^ 0x85eb, c ^ 0xc2b2, d];
}
function createEngineFromCode(code) {
  const sockets = new Set();
  const pubsub = {
    publish(topic, msg) {
      const s = String(msg);
      for (const sock of sockets) {
        if (sock.readyState === 1) {
          try { sock.send(s); } catch (e) {}
        }
      }
    }
  };
  const sandbox = {
    state, pubsub, console, Math, Date, JSON,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Uint8Array, Array, Object, String, Number, Boolean, Map, Set, Promise,
    TextEncoder, TextDecoder
  };
  sandbox.self = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "server-plugin.js" });
  const api = sandbox.self;
  if (!api.rpc) throw new Error("server script did not set self.rpc");
  let nextId = 1;
  function connect(ip, send, isProxy) {
    const id = "c" + (nextId++) + "_" + Date.now().toString(36);
    const net = netForIp(ip);
    const conn = { id, net, isProxy: isProxy === true, send: (msg) => { try { send(String(msg)); } catch (e) {} } };
    api.onopen && api.onopen({ conn });
    dirty = true;
    return conn;
  }
  function message(conn, data) {
    api.onmessage && api.onmessage({ conn, data: String(data) });
    dirty = true;
  }
  async function rpc(conn, method, data) {
    const fn = api.rpc[method];
    if (typeof fn !== "function") throw new Error("no RPC method '" + method + "'");
    const out = fn({ conn }, data);
    const res = out && typeof out.then === "function" ? await out : out;
    dirty = true;
    return res == null ? "" : String(res);
  }
  function close(conn) {
    try { api.onclose && api.onclose({ conn }); } catch (e) {}
    dirty = true;
  }
  return { connect, message, rpc, close, sockets };
}
module.exports = { createEngine: createEngineFromCode, createEngineFromCode, UPLOAD_DIR, STATE_FILE };
