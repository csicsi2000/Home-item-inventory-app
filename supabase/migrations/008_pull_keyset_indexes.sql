-- Keyset-pagination indexes for the sync pull.
--
-- touch_server_updated_at() sets server_updated_at from now(), the TRANSACTION
-- timestamp, so every row written by one statement shares an identical value.
-- A cursor of the form `server_updated_at > <last row's value>` therefore skips
-- the rest of a same-timestamp group whenever a page boundary lands inside one,
-- and because the cursor only moves forward those rows are never pulled again.
--
-- The client now pages by the composite key (server_updated_at, id), which is
-- unique because id is the primary key. These indexes match that ordering.
--
-- Safe to re-run.

create index if not exists collections_keyset_idx
  on public.collections (server_updated_at, id);

create index if not exists items_keyset_idx
  on public.items (server_updated_at, id);

create index if not exists item_photos_keyset_idx
  on public.item_photos (server_updated_at, id);
