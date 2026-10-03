# Chat Room — Vercel edition

The exact same chat UI, rebuilt for Vercel:

- **Messages / realtime:** Supabase (Realtime broadcast + presence, Postgres history,
  Storage uploads). Your existing Supabase project keeps working — chat history is preserved.
- **Translator:** Google Translate via `/api/translate` (free endpoint, no API key).
- **Uploads:** Supabase Storage bucket `chat-media` (photos, voice notes, avatars).

## Deploy in 10 minutes

### 1. Supabase (5 min)

1. Open your Supabase project → **SQL editor** → paste `supabase.sql` → Run.
   (Keeps your existing `messages` rows. Adds the `room_meta` table + storage bucket.)
2. **Project Settings → API**: copy the **Project URL** and **anon public key**.

### 2. GitHub (2 min)

Upload this whole folder to a new GitHub repo (drag-drop on github.com, or):

```
git init
git add .
git commit -m "chat room vercel edition"
git branch -M main
git remote add origin https://github.com/YOU/chat-room.git
git push -u origin main
```

### 3. Vercel (3 min)

1. Vercel → **Add New → Project** → import the repo.
2. **Environment Variables** (optional — it works without them, using your current project):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `ADMIN_PASSWORD_HASH` — only if you want to change the admin password
     (set it to the sha256 hex of the new password).
3. **Deploy.** Open the URL — same chat, same admin password, same history.

## Project layout

```
public/
  index.html   the chat UI (same design, same features)
  app.js       chat code (same behavior, Supabase-backed)
  shim.js      adapter: Supabase realtime + Google Translate under the hood
  profanity.json  word filter list
api/
  translate.js    Google Translate proxy (POST {texts, target})
  admin-login.js  admin password check (sha256 vs ADMIN_PASSWORD_HASH)
  config.js       serves SUPABASE_URL / SUPABASE_ANON_KEY to the frontend
supabase.sql      tables + storage bucket + policies
```

## Notes / differences from the Perchance version

- VPN / datacenter / region join-blocking is **off** (that signal came from Perchance's
  network layer, which doesn't exist on Vercel). The admin can still ban users by name.
- Private (DM) realtime goes through per-user inbox channels instead of a central socket
  server. For maximum DM privacy, enable **Realtime authorization** in Supabase later.
- The admin password is unchanged. To rotate it, set `ADMIN_PASSWORD_HASH` to the
  sha256 hex of a new password (`echo -n "newpass" | sha256sum`).
- Supabase publishable/anon keys are public by design (they're in the frontend). Real
  security comes from Row Level Security — tighten the policies in `supabase.sql` if
  you ever need stricter rules.
- Giphy search uses the same key as before.
