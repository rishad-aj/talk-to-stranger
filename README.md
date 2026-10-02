# Chat Room — Vercel + Supabase + Google Translate

All message functions run on Supabase. Translation runs through Google via `/api/translate`.

## 1. Supabase
1. Create project at supabase.com
2. SQL Editor -> paste `supabase/schema.sql` -> Run (creates `messages` table + open policies + realtime).
3. Copy Project URL + anon key.

## 2. Vercel
1. `npx vercel` in this folder (or drag-drop import in vercel.com dashboard).
2. Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, optional `GOOGLE_TRANSLATE_API_KEY` (without it the free Google endpoint is used).
3. Deploy. Chat reads/writes Supabase directly (`lib/chat.js`, realtime subscribed). Translate calls `POST /api/translate {texts:[...], target:"es"}` (`lib/translate-client.js`).

## 3. Point your old frontend at it
- Replace every `socket.rpc.*` message call with `lib/chat.js` (`sendMessage`, `fetchRoom`, `subscribeRoom`, `editMessage`, `deleteMessage`).
- Replace every `root.ai(...)` translate call with `googleTranslate(texts, targetLang)`.
- Keep your existing Supabase `messages` table — same column names, no migration needed.
