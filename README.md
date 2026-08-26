# Chat Room — self-hosted (Vercel + Supabase)

This is the same Chat Room you already run on Perchance, rebuilt as a normal
website you can host on your **own domain** (e.g. `chat.example.com`). It uses
the **same Supabase project**, so all your existing chat history, messages and
settings stay visible — nothing is lost.

## How it works

| Piece | File | Role |
|---|---|---|
| The website | `index.html`, `client.js` | The chat UI (same as the Perchance version) |
| The backend | `api/app.js` | A Vercel serverless function. Authoritative: ban checks on every post, ownership checks on edit/delete, and all admin actions (ban/unban/verify/title/icon/clear/flag). No database credentials live in the browser. |
| Live updates | Supabase Realtime | New messages, edits, deletions, bans, title/icon changes stream to everyone instantly. Online list + "typing…" use Realtime presence. |
| Storage | Supabase Storage | Photo / voice messages / group icons are uploaded to public buckets. |
| History | Supabase `messages` table | The SAME table your Perchance version writes to. |

## What you need

- The **Supabase project you already have** (the one your Perchance chat uses).
  Its URL and anon key are already baked into `client.js`.
- A **Vercel** account (free tier is fine) and optionally a GitHub account.
- No server to maintain, no credit card required.

## Setup (once)

### 1. Run the SQL setup in Supabase

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the whole contents of `SETUP.sql` into the editor.
3. Click **Run**. (It's safe to run more than once.)

This adds a `flagged` column, creates the `bans`/`verified`/`settings` tables,
enables realtime, and creates the `images`/`voice`/`icons` storage buckets.

### 2. Put this folder on GitHub

1. Create a new repository on GitHub (public or private — either is fine).
2. Push the contents of this `vercel` folder into it. The easiest way is a drag
   & drop: on the repo page click **Add file → Upload files**, drop the whole
   folder's contents in, and commit.

### 3. Import into Vercel

1. Go to https://vercel.com/new → **Import** the GitHub repo you just made.
2. Vercel detects a Node project automatically. No build settings to change.

### 4. Add the secret environment variables

In Vercel: **Project → Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://yvqndfyiwkegxkeolvoh.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Your project's **service role** key (Supabase → Project Settings → API). Keep it secret — it is only read by the Vercel function, never sent to browsers. |

The **anon** key (which is public by design) is already inside `client.js` —
you don't need to add it.

### 5. Deploy

Click **Deploy**. When it finishes you get a `https://your-project.vercel.app`
URL. Add your own domain under **Project → Settings → Domains** if you want.

## Admin password

Your existing admin password from the Perchance version **still works** — the
same password hash is embedded in `api/app.js`, so you don't need to change
anything. Log in as name `admin` with your password, as before.

To rotate the password later:

```js
// paste into a browser console, or use any online sha256 tool:
// 4b0cb7d092e40e08a3b89691888b63b1bc4ebf0352f9b49399b11845f1d09b38  == sha256( yourPassword )
```

then replace the `ADMIN_HASH` value in `api/app.js` (or set an `ADMIN_HASH`
environment variable in Vercel and clear the one in the file). Use a long,
random password — the hash is public.

## Feature parity with the Perchance version

Everything is included: text/photo/voice messages, replies, edits, delete
(with or without a trace), link previews, translation, emoji, GIFs, admin
tools (ban/unban, verify badge, title & icon, clear history, flag), the online
list with locations (admin-only), unread banner, notifications, installable
PWA, and the 18+ gate.

## Troubleshooting

- **Messages don't appear live / online list stuck on "offline".** You almost
  certainly haven't run `SETUP.sql` — realtime is only enabled by that step.
- **"Couldn't send" / "http_404" toast when sending.** The client posts to
  `/api`, which `vercel.json` rewrites to the `api/app.js` function. If you
  deployed before this rewrite existed, re-deploy the latest code — otherwise
  every send 404s while reads (which go straight to Supabase) still work.
- **"server not configured" error.** Set `SUPABASE_URL` and
  `SUPABASE_SERVICE_KEY` in Vercel (Project → Settings → Environment
  Variables) and redeploy. Admin actions also need the service key.
- **"Upload failed".** Make sure the SQL step ran; it creates the storage
  buckets and upload policies.
- **Admin actions fail.** Check that `SUPABASE_SERVICE_KEY` is set in Vercel —
  admin writes go through the serverless function, which needs the service key.

## Security notes

- The browser only ever sees the public **anon** key. All writes go through
  `api/app.js`, which enforces bans and message ownership server-side.
- Bans are also enforced directly in the database (a banned nickname cannot
  insert, no matter what). This protects both the old and the new app.
- Everything in `api/app.js` is public source, like the old Perchance server
  plugin was. That's why the admin password is stored only as a hash.
