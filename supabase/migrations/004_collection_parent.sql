-- Adds folder-style nesting: a collection may point at a parent collection.
-- Run this once in the Supabase SQL editor on projects created before this feature.
alter table public.collections
  add column if not exists parent_id uuid;
