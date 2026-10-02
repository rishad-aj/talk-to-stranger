"use strict";
(function () {
  window.generatorName = window.generatorName || "chat-room";
  var root = window.root || (window.root = {});
  function store(ns) {
    return {
      get: function (k) { return Promise.resolve(window.localStorage.getItem(ns + ":" + k)); },
      set: function (k, v) { try { window.localStorage.setItem(ns + ":" + k, String(v)); } catch (e) {} return Promise.resolve(); },
      delete: function (k) { try { window.localStorage.removeItem(ns + ":" + k); } catch (e) {} return Promise.resolve(); }
    };
  }
  if (!root.kv) {
    root.kv = {
      identity: store("kv_identity"),
      reactions: store("kv_reactions"),
      replies: store("kv_replies")
    };
  }
  if (!root.superFetch) {
    root.superFetch = function (url, opts) { return fetch(url, opts); };
  }
  if (!root.uploadPlugin) {
    root.uploadPlugin = function (blob) {
      return fetch("/uploads", { method: "POST", body: blob }).then(function (r) { return r.json(); });
    };
  }
  function wsUrl() {
    try {
      var q = new URLSearchParams(window.location.search).get("ws");
      if (q) { window.localStorage.setItem("tgWsUrl", q); return q; }
      var saved = window.localStorage.getItem("tgWsUrl");
      if (saved) return saved;
    } catch (e) {}
    var proto = window.location.protocol === "https:" ? "wss://" : "ws://";
    return proto + window.location.host + "/ws";
  }
  if (!root.createServerSocket) {
    root.createServerSocket = function () {
      var ws = new WebSocket(wsUrl());
      var seq = 0;
      var pending = {};
      var listeners = { open: [], message: [], close: [], error: [] };
      ws.addEventListener("open", function (e) { listeners.open.slice().forEach(function (fn) { fn(e); }); });
      ws.addEventListener("message", function (e) {
        var raw = String((e && e.data) || "");
        try {
          var o = JSON.parse(raw);
          if (o && typeof o === "object" && o.id !== undefined && (o.result !== undefined || o.error !== undefined)) {
            var p = pending[o.id];
            if (p) {
              delete pending[o.id];
              if (o.error !== undefined) p[1](new Error(String(o.error)));
              else p[0](o.result);
              return;
            }
          }
        } catch (err) {}
        listeners.message.slice().forEach(function (fn) { fn({ data: raw }); });
      });
      ws.addEventListener("close", function (e) { listeners.close.slice().forEach(function (fn) { fn(e); }); });
      ws.addEventListener("error", function (e) { listeners.error.slice().forEach(function (fn) { fn(e); }); });
      var rpc = new Proxy({}, {
        get: function (_, method) {
          return function (data) {
            return new Promise(function (resolve, reject) {
              var id = "r" + (++seq) + "_" + Date.now().toString(36);
              pending[id] = [resolve, reject];
              var payload = JSON.stringify({ id: id, rpc: String(method), data: data === undefined ? "" : data });
              if (ws.readyState === 1) ws.send(payload);
              else {
                var t = setInterval(function () {
                  if (ws.readyState === 1) { clearInterval(t); ws.send(payload); }
                  else if (ws.readyState > 1) { clearInterval(t); delete pending[id]; reject(new Error("socket closed")); }
                }, 100);
                setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error("rpc timeout")); } }, 30000);
              }
              setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error("rpc timeout")); } }, 30000);
            });
          };
        }
      });
      return {
        get readyState() { return ws.readyState; },
        addEventListener: function (t, fn) { if (listeners[t]) listeners[t].push(fn); },
        removeEventListener: function (t, fn) { if (listeners[t]) listeners[t] = listeners[t].filter(function (f) { return f !== fn; }); },
        send: function (d) { ws.send(d); },
        close: function () { ws.close(); },
        rpc: rpc
      };
    };
  }
})();
