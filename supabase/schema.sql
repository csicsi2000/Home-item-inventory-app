-- Card Collection Scanner — Supabase schema
--
-- COMPLETE END STATE. Migrations 001–008 are folded into this file.
-- Fresh install: run this whole file once in your project's SQL editor
-- (Dashboard → SQL → New query). You do NOT need anything from
-- supabase/migrations/ — those files exist only to upgrade a project that
-- was created against an older version of this schema.
--
-- Notes:
--  * updated_at is the CLIENT's last-write-wins timestamp.
--  * server_updated_at is the server-side pull cursor (bumped by trigger).
--    It is set from now(), the TRANSACTION timestamp, so every row written by
--    one statement shares a value — the client pages by (server_updated_at, id)
--    for that reason.
--  * No FKs between synced tables: rows can arrive in any order during sync;
--    integrity is enforced client-side (deliberate local-first tradeoff).
--  * Embeddings/pHashes are NOT synced — they are derived data that each
--    device recomputes locally from the photos.

-- ===========================================================================
-- Tables
-- ===========================================================================

create table public.collections (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id uuid,
  name text not null,
  icon text,
  description text,
  fields jsonb not null default '[]',
  display jsonb,
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
  currency text,
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

-- Sharing: per-collection access grants by email.
--
--  * Roles: read < write < owner. A grant applies to the collection AND its
--    whole subtree (role is resolved by walking up the parent chain).
--  * Grantees are matched by the email in their JWT (Google / magic link),
--    so a share works even before the invitee has ever signed in.
--  * Shares are soft-deleted (deleted_at) so revocations bump the sync
--    cursor and reach the grantee's device, which then purges local copies.
create table public.collection_shares (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  grantee_email text not null,
  role text not null check (role in ('read', 'write', 'owner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (collection_id, grantee_email)
);

-- ===========================================================================
-- Trigger functions and triggers
-- ===========================================================================

create or replace function public.touch_server_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.server_updated_at = now();
  return new;
end;
$$;

-- emails must be normalized or JWT matching silently fails
create or replace function public.normalize_share_email()
returns trigger
language plpgsql
as $$
begin
  new.grantee_email = lower(trim(new.grantee_email));
  return new;
end;
$$;

create trigger t_collections_touch before insert or update on public.collections
  for each row execute function public.touch_server_updated_at();
create trigger t_items_touch before insert or update on public.items
  for each row execute function public.touch_server_updated_at();
create trigger t_item_photos_touch before insert or update on public.item_photos
  for each row execute function public.touch_server_updated_at();
create trigger t_collection_shares_touch before insert or update on public.collection_shares
  for each row execute function public.touch_server_updated_at();

create trigger t_collection_shares_email before insert or update on public.collection_shares
  for each row execute function public.normalize_share_email();

-- ===========================================================================
-- Indexes
-- ===========================================================================

-- owner-scoped scans (RLS's user_id branch)
create index collections_pull_idx on public.collections (user_id, server_updated_at);
create index items_pull_idx on public.items (user_id, server_updated_at);
create index item_photos_pull_idx on public.item_photos (user_id, server_updated_at);

-- the client's keyset pull: order by (server_updated_at, id)
create index collections_keyset_idx on public.collections (server_updated_at, id);
create index items_keyset_idx on public.items (server_updated_at, id);
create index item_photos_keyset_idx on public.item_photos (server_updated_at, id);

create index collection_shares_grantee_idx on public.collection_shares (grantee_email);
create index collections_parent_idx on public.collections (parent_id);
create index item_photos_storage_path_idx on public.item_photos (storage_path);

-- ===========================================================================
-- Role resolution
-- ===========================================================================
-- security definer: policies call these on every row; running them under the
-- caller's RLS would recurse into the very policies being evaluated.

create or replace function public.collection_role(cid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with recursive chain as (
    select id, parent_id, user_id from collections where id = cid
    union all
    select c.id, c.parent_id, c.user_id
    from collections c
    join chain on c.id = chain.parent_id
  ) cycle id set is_cycle using path
  select case
    when exists (select 1 from chain where not is_cycle and user_id = auth.uid()) then 'owner'
    else (
      select s.role
      from collection_shares s
      join chain on chain.id = s.collection_id and not chain.is_cycle
      where s.deleted_at is null
        and s.grantee_email = lower(coalesce(auth.jwt() ->> 'email', ''))
      order by case s.role when 'owner' then 3 when 'write' then 2 else 1 end desc
      limit 1
    )
  end;
$$;

create or replace function public.item_role(iid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.collection_role(i.collection_id) from items i where i.id = iid;
$$;

create or replace function public.can_read_photo_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from item_photos p
    where p.storage_path = object_name
      and public.item_role(p.item_id) is not null
  );
$$;

-- Cheap change-detection for the sync engine: one RPC call answers
-- "did anything visible to me change since my last pull?" so the periodic
-- sync can skip pulling all tables when nothing happened.
--
-- Security INVOKER on purpose: RLS applies, so the max() only covers rows
-- the caller can see (own + shared).
create or replace function public.sync_cursor()
returns timestamptz
language sql
stable
as $$
  select greatest(
    coalesce((select max(server_updated_at) from public.collections), 'epoch'::timestamptz),
    coalesce((select max(server_updated_at) from public.items), 'epoch'::timestamptz),
    coalesce((select max(server_updated_at) from public.item_photos), 'epoch'::timestamptz),
    coalesce((select max(server_updated_at) from public.collection_shares), 'epoch'::timestamptz)
  );
$$;

grant execute on function public.collection_role(uuid) to authenticated;
grant execute on function public.item_role(uuid) to authenticated;
grant execute on function public.can_read_photo_object(text) to authenticated;
grant execute on function public.sync_cursor() to authenticated;

-- ===========================================================================
-- Row level security
-- ===========================================================================

alter table public.collections enable row level security;
alter table public.items enable row level security;
alter table public.item_photos enable row level security;
alter table public.collection_shares enable row level security;

create policy "collections select" on public.collections
  for select to authenticated
  using (user_id = auth.uid() or public.collection_role(id) is not null);

-- new rows are always owned by their creator; creating inside someone
-- else's folder requires write access to that folder
create policy "collections insert" on public.collections
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (parent_id is null or public.collection_role(parent_id) in ('write', 'owner'))
  );

create policy "collections update" on public.collections
  for update to authenticated
  using (user_id = auth.uid() or public.collection_role(id) in ('write', 'owner'))
  with check (user_id = auth.uid() or public.collection_role(id) in ('write', 'owner'));

create policy "collections delete" on public.collections
  for delete to authenticated
  using (user_id = auth.uid() or public.collection_role(id) = 'owner');

create policy "items select" on public.items
  for select to authenticated
  using (user_id = auth.uid() or public.collection_role(collection_id) is not null);

create policy "items insert" on public.items
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.collection_role(collection_id) in ('write', 'owner')
  );

create policy "items update" on public.items
  for update to authenticated
  using (user_id = auth.uid() or public.collection_role(collection_id) in ('write', 'owner'))
  with check (user_id = auth.uid() or public.collection_role(collection_id) in ('write', 'owner'));

create policy "items delete" on public.items
  for delete to authenticated
  using (user_id = auth.uid() or public.collection_role(collection_id) in ('write', 'owner'));

create policy "item_photos select" on public.item_photos
  for select to authenticated
  using (user_id = auth.uid() or public.item_role(item_id) is not null);

create policy "item_photos insert" on public.item_photos
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.item_role(item_id) in ('write', 'owner')
  );

create policy "item_photos update" on public.item_photos
  for update to authenticated
  using (user_id = auth.uid() or public.item_role(item_id) in ('write', 'owner'))
  with check (user_id = auth.uid() or public.item_role(item_id) in ('write', 'owner'));

create policy "item_photos delete" on public.item_photos
  for delete to authenticated
  using (user_id = auth.uid() or public.item_role(item_id) in ('write', 'owner'));

create policy "shares select" on public.collection_shares
  for select to authenticated
  using (
    owner_id = auth.uid()
    or grantee_email = lower(coalesce(auth.jwt() ->> 'email', ''))
    or public.collection_role(collection_id) = 'owner'
  );

create policy "shares insert" on public.collection_shares
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and public.collection_role(collection_id) = 'owner'
  );

create policy "shares update" on public.collection_shares
  for update to authenticated
  using (public.collection_role(collection_id) = 'owner')
  with check (public.collection_role(collection_id) = 'owner');

-- owners manage shares; a grantee may hard-delete their own share to leave
create policy "shares delete" on public.collection_shares
  for delete to authenticated
  using (
    public.collection_role(collection_id) = 'owner'
    or grantee_email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- ===========================================================================
-- Storage bucket for photos
-- ===========================================================================
-- Uploads always go to the uploader's own {userId}/ folder, so the owner
-- insert/update/delete policies stay correct for shared collections too;
-- grantees get read access through can_read_photo_object().

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

create policy "shared photos read" on storage.objects
  for select to authenticated
  using (bucket_id = 'item-photos' and public.can_read_photo_object(name));

-- ===========================================================================
-- Least-privilege hardening
-- ===========================================================================
-- Postgres grants EXECUTE to PUBLIC by default on CREATE FUNCTION, which lets
-- the signed-out `anon` role call these. They leak nothing (every one gates on
-- auth.uid()/the JWT email, so anon gets null/false/epoch), but SECURITY
-- DEFINER functions should not be reachable by roles with no reason to call
-- them. `authenticated` keeps its explicit grant above.
--
-- Trigger functions are invoked by the trigger mechanism, which doesn't check
-- EXECUTE on the function — triggers keep firing regardless.

revoke execute on function public.sync_cursor() from public, anon;
revoke execute on function public.collection_role(uuid) from public, anon;
revoke execute on function public.item_role(uuid) from public, anon;
revoke execute on function public.can_read_photo_object(text) from public, anon;
revoke execute on function public.normalize_share_email() from public, anon;
revoke execute on function public.touch_server_updated_at() from public, anon;
