-- Adds the per-collection display settings column (view mode + item labels).
-- Run this once in the Supabase SQL editor on projects created before this feature.
alter table public.collections
  add column if not exists display jsonb;
