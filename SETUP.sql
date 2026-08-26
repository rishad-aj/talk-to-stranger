-- ============================================================
-- Chat Room — one-time Supabase setup.
-- Run this ONCE in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is safe to run multiple times (everything is idempotent).
-- ============================================================

-- 1) Add the missing `flagged` column to messages (keeps existing rows intact).
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS flagged boolean DEFAULT false;

-- 2) New tables for admin/moderation state.
CREATE TABLE IF NOT EXISTS public.settings (key text PRIMARY KEY, value text);
CREATE TABLE IF NOT EXISTS public.bans (name text PRIMARY KEY, ts bigint, by text);
CREATE TABLE IF NOT EXISTS public.verified (name text PRIMARY KEY, ts bigint);

INSERT INTO public.settings (key, value) VALUES ('title', 'Chat Room') ON CONFLICT (key) DO NOTHING;
INSERT INTO public.settings (key, value) VALUES ('icon', '') ON CONFLICT (key) DO NOTHING;

-- 3) RLS: anyone may READ settings/bans/verified (they are public chat state),
--    but only the serverless function (service role) may write to them.
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verified ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "public read settings" ON public.settings FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "public read bans" ON public.bans FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "public read verified" ON public.verified FOR SELECT USING (true);

-- 4) messages: make sure the old app's public read/insert/update/delete still
--    work (this is how the current Perchance version stores history). If RLS was
--    never enabled on messages these policies simply match the previous behaviour.
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "public select messages" ON public.messages FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "public insert messages" ON public.messages FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "public update messages" ON public.messages FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "public delete messages" ON public.messages FOR DELETE USING (true);

-- 5) Enforce bans in the DATABASE: a banned nickname can never insert a message,
--    no matter which client or path tries to (covers both the old and new app).
CREATE OR REPLACE FUNCTION public.block_banned()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bans WHERE name = new.sender) THEN
    RAISE EXCEPTION 'banned';
  END IF;
  RETURN new;
END $$;
DROP TRIGGER IF EXISTS block_banned_insert ON public.messages;
CREATE TRIGGER block_banned_insert BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.block_banned();

-- 6) Enable realtime on the tables the app subscribes to (idempotent).
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.bans;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.verified;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.settings;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 7) Public storage buckets for images, voice messages and group icons.
INSERT INTO storage.buckets (id, name, public) VALUES
  ('images', 'images', true),
  ('voice', 'voice', true),
  ('icons', 'icons', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Allow anonymous uploads into these three buckets (files are public).
CREATE POLICY IF NOT EXISTS "public upload images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'images');
CREATE POLICY IF NOT EXISTS "public upload voice" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'voice');
CREATE POLICY IF NOT EXISTS "public upload icons" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'icons');

-- Done. Next: copy your Supabase URL + anon key + service role key into the Vercel
-- project (see README.md). The anon key is already baked into index.html/client.js.
