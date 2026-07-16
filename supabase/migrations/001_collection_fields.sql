-- Adds the per-collection field template column.
-- Run this once in the Supabase SQL editor on projects created before this feature.
alter table public.collections
  add column if not exists fields jsonb not null default '[]';
