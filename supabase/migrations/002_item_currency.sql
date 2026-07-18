-- Adds the per-item currency code for price fields.
-- Run this once in the Supabase SQL editor on projects created before this feature.
alter table public.items
  add column if not exists currency text;
