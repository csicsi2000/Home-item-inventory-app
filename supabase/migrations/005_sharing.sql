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

create trigger t_collection_shares_touch before insert or update on public.collection_shares
  for each row execute function public.touch_server_updated_at();

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

create trigger t_collection_shares_email before insert or update on public.collection_shares
  for each row execute function public.normalize_share_email();

create index collection_shares_grantee_idx on public.collection_shares (grantee_email);
create index collections_parent_idx on public.collections (parent_id);
create index item_photos_storage_path_idx on public.item_photos (storage_path);

-- ===== role resolution =====
-- security definer: policies call this on every row; running it under the
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

grant execute on function public.collection_role(uuid) to authenticated;
grant execute on function public.item_role(uuid) to authenticated;

-- ===== replace owner-only policies =====

drop policy "own rows" on public.collections;
drop policy "own rows" on public.items;
drop policy "own rows" on public.item_photos;

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

-- ===== shares table policies =====

alter table public.collection_shares enable row level security;

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

-- ===== storage: grantees may read photo objects of shared items =====
-- (uploads keep going to the uploader's own {userId}/ folder, so the
-- existing insert/update/delete policies stay correct)

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

grant execute on function public.can_read_photo_object(text) to authenticated;

create policy "shared photos read" on storage.objects
  for select to authenticated
  using (bucket_id = 'item-photos' and public.can_read_photo_object(name));
