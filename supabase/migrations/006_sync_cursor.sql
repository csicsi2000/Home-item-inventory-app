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

grant execute on function public.sync_cursor() to authenticated;
