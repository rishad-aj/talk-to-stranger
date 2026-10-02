create table if not exists public.messages (
  id bigint generated always as identity primary key,
  ts bigint not null,
  sender text not null,
  type text not null default 'chat',
  text text,
  url text,
  dur double precision,
  size integer,
  reply_to jsonb,
  flagged boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists messages_ts_idx on public.messages (ts desc);
create index if not exists messages_type_ts_idx on public.messages (type, ts desc);
create index if not exists messages_sender_idx on public.messages (sender);
alter table public.messages enable row level security;
drop policy if exists "open read" on public.messages;
create policy "open read" on public.messages for select to anon, authenticated using (true);
drop policy if exists "open insert" on public.messages;
create policy "open insert" on public.messages for insert to anon, authenticated with check (true);
drop policy if exists "open update" on public.messages;
create policy "open update" on public.messages for update to anon, authenticated using (true) with check (true);
drop policy if exists "open delete" on public.messages;
create policy "open delete" on public.messages for delete to anon, authenticated using (true);
alter publication supabase_realtime add table public.messages;
