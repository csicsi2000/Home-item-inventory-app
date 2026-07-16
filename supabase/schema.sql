-- Card Collection Scanner — Supabase schema
-- Run this once in your project's SQL editor (Dashboard → SQL → New query).
--
-- Notes:
--  * updated_at is the CLIENT's last-write-wins timestamp.
--  * server_updated_at is the server-side pull cursor (bumped by trigger).
--  * No FKs between synced tables: rows can arrive in any order during sync;
--    integrity is enforced client-side (deliberate local-first tradeoff).
--  * Embeddings/pHashes are NOT synced — they are derived data that each
--    device recomputes locally from the photos.

create table public.collections (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  icon text,
  description text,
  fields jsonb not null default '[]',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.items (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  collection_id uuid not null,
  name text not null default '',
  description text,
  quantity int not null default 1,
  status text not null default 'owned' check (status in ('owned', 'sold', 'wishlist')),
  condition text,
  tags text[] not null default '{}',
  barcode text,
  ocr_text text,
  acquisition_price numeric,
  acquisition_date date,
  sold_price numeric,
  sold_date date,
  custom_fields jsonb not null default '{}',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.item_photos (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null,
  storage_path text,
  is_primary boolean not null default false,
  width int,
  height int,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ===== server cursor trigger =====
create or replace function public.touch_server_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.server_updated_at = now();
  return new;
end;
$$;

create trigger t_collections_touch before insert or update on public.collections
  for each row execute function public.touch_server_updated_at();
create trigger t_items_touch before insert or update on public.items
  for each row execute function public.touch_server_updated_at();
create trigger t_item_photos_touch before insert or update on public.item_photos
  for each row execute function public.touch_server_updated_at();

-- ===== pull-query indexes =====
create index collections_pull_idx on public.collections (user_id, server_updated_at);
create index items_pull_idx on public.items (user_id, server_updated_at);
create index item_photos_pull_idx on public.item_photos (user_id, server_updated_at);

-- ===== row level security =====
alter table public.collections enable row level security;
alter table public.items enable row level security;
alter table public.item_photos enable row level security;

create policy "own rows" on public.collections
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "own rows" on public.items
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "own rows" on public.item_photos
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ===== storage bucket for photos =====
insert into storage.buckets (id, name, public)
values ('item-photos', 'item-photos', false);

create policy "own photos read" on storage.objects
  for select to authenticated
  using (bucket_id = 'item-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own photos insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'item-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own photos update" on storage.objects
  for update to authenticated
  using (bucket_id = 'item-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own photos delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'item-photos' and (storage.foldername(name))[1] = auth.uid()::text);
