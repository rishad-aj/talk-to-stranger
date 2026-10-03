-- Chat Room: Supabase setup for the Vercel version.
-- Run this in your Supabase project (SQL editor). Safe to re-run: it only adds
-- what is missing and keeps your existing `messages` rows.
--
-- What each part does:
--   messages  : chat history + DM mirror (your app already writes here).
--   room_meta : room title/icon, bans, verified users, avatars, reactions,
--               deleted-message archive, fake presence. New table.
--   storage   : chat-media bucket for photo / voice uploads.

-- 1) messages table (created only if you don't have it yet)
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  ts bigint,
  sender text,
  type text,
  text text,
  url text,
  dur double precision,
  size integer,
  reply_to text,
  flagged boolean not null default false
);
create index if not exists messages_ts_idx on public.messages (ts desc);
create index if not exists messages_type_idx on public.messages (type);
create index if not exists messages_sender_idx on public.messages (sender);

-- 2) room state table (new - required)
create table if not exists public.room_meta (
  key text primary key,
  value jsonb
);

-- 3) open access (public chat: anyone can read/write; tighten later if you want)
alter table public.messages enable row level security;
alter table public.room_meta enable row level security;
drop policy if exists "public all messages" on public.messages;
create policy "public all messages" on public.messages for all using (true) with check (true);
drop policy if exists "public all room_meta" on public.room_meta;
create policy "public all room_meta" on public.room_meta for all using (true) with check (true);

-- 4) storage bucket for uploads (photos, voice notes, avatars, group icon)
insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', true)
on conflict (id) do nothing;

drop policy if exists "public read media" on storage.objects;
create policy "public read media" on storage.objects for select using (bucket_id = 'chat-media');
drop policy if exists "public upload media" on storage.objects;
create policy "public upload media" on storage.objects for insert with check (bucket_id = 'chat-media');
drop policy if exists "public update media" on storage.objects;
create policy "public update media" on storage.objects for update using (bucket_id = 'chat-media');
drop policy if exists "public delete media" on storage.objects;
create policy "public delete media" on storage.objects for delete using (bucket_id = 'chat-media');

-- 5) realtime: broadcast + presence work without any extra setup. Nothing to do.
