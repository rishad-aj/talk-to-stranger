# Chat room — Render deploy

Same room, same Supabase message DB (`messages` table — history carries over).
AI translate is off, no AI key needed.

## Files

- `index.html` — markup only (~28 KB).
- `css/style.css` — all styles.
- `js/head.js` — viewport/meta bootstrap (runs first).
- `js/app.js` — the whole chat client (ES module).
- `js/compat.js` — non-Perchance shims (kv/superFetch/upload/socket).
- `server/plugin.js` — the authoritative server code (runs in Node, never
  served to browsers). After editing the room, refresh this file from the
  workspace `index.html` server script.
- `server.js` / `engine.js` / `export.js` — static host + `/uploads` +
  WebSocket `/ws` + engine harness + dist builder.

## Deploy (GitHub → Render)

1. Push **this folder's contents** to a GitHub repo root (all files sit next to
   each other: `index.html`, `main.pjs`, `server.js`, `engine.js`, `export.js`,
   `compat.js`, `package.json`, `render.yaml`).
2. Render → New → Blueprint → select the repo. `render.yaml` sets build
   (`npm install && npm run export`) and start (`npm start`).
3. Open the service URL — done.

## Notes

- WebSockets need a running process: keep this service on Render. Vercel
  cannot host the chat backend (serverless has no persistent sockets).
- The 1 GB disk in `render.yaml` needs a paid instance. On the free plan
  there is no disk, so `state.bin`/`uploads/` reset on restart — Supabase
  history still survives. Practical floor: Starter + disk.
- `?ws=wss://your-backend.onrender.com/ws` points any copy of the page at
  this backend.
- After editing the room here, copy the new `index.html`/`main.pjs` over the
  repo copies and redeploy.
