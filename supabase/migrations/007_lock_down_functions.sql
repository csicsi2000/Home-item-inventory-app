-- Least-privilege hardening for the sharing/sync helper functions.
--
-- Postgres grants EXECUTE to PUBLIC by default on CREATE FUNCTION, which let
-- the signed-out `anon` role call these. They leak nothing today (every one
-- gates on auth.uid()/the JWT email, so anon gets null/false/epoch), but
-- SECURITY DEFINER functions should not be reachable by roles that have no
-- reason to call them. `authenticated` keeps its explicit grant from
-- migration 005/006, so the app is unaffected.

revoke execute on function public.sync_cursor() from public, anon;
revoke execute on function public.collection_role(uuid) from public, anon;
revoke execute on function public.item_role(uuid) from public, anon;
revoke execute on function public.can_read_photo_object(text) from public, anon;

-- Trigger functions are invoked by the trigger mechanism (which doesn't check
-- EXECUTE on the function), never meaningfully over the API — lock them down
-- too for good measure. Triggers keep firing regardless.
revoke execute on function public.normalize_share_email() from public, anon;
revoke execute on function public.touch_server_updated_at() from public, anon;
