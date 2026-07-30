import type { Session } from '@supabase/supabase-js';
import { base } from '$app/paths';
import { supabase } from './supabase';

class AuthState {
	session = $state<Session | null>(null);
	ready = $state(false);
	/**
	 * Who is signed in, as a plain value.
	 *
	 * Effects must depend on this rather than on `session`: Supabase mints a new
	 * session object on every TOKEN_REFRESHED (roughly hourly), and a `$state`
	 * object's identity change would re-run a full sync each time. A `$derived`
	 * only propagates when the value actually differs.
	 */
	userId = $derived(this.session?.user.id ?? null);
}

export const auth = new AuthState();

let initialized = false;

export function initAuth(): void {
	if (initialized || !supabase) {
		auth.ready = true;
		return;
	}
	initialized = true;
	supabase.auth.getSession().then(({ data }) => {
		auth.session = data.session;
		auth.ready = true;
	});
	supabase.auth.onAuthStateChange((event, session) => {
		// getSession() above already seeds the initial value; INITIAL_SESSION would
		// otherwise fire a second, redundant update on boot
		if (event === 'INITIAL_SESSION') return;
		auth.session = session;
		auth.ready = true;
	});
}

const redirectTo = () => location.origin + base + '/auth/callback';

export async function signInWithGoogle(): Promise<void> {
	if (!supabase) return;
	await supabase.auth.signInWithOAuth({
		provider: 'google',
		options: { redirectTo: redirectTo() }
	});
}

export async function signInWithMagicLink(email: string): Promise<{ error: string | null }> {
	if (!supabase) return { error: 'Sync is not configured' };
	const { error } = await supabase.auth.signInWithOtp({
		email,
		options: { emailRedirectTo: redirectTo() }
	});
	return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
	await supabase?.auth.signOut();
}
