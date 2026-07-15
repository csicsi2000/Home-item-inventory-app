import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

const url = env.PUBLIC_SUPABASE_URL;
const anonKey = env.PUBLIC_SUPABASE_ANON_KEY;

/** Null when the app runs without a configured Supabase project (local-only mode). */
export const supabase: SupabaseClient | null =
	url && anonKey ? createClient(url, anonKey) : null;

export const syncConfigured = supabase !== null;
