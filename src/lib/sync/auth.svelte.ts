import type { Session } from '@supabase/supabase-js';
import { base } from '$app/paths';
import { supabase } from './supabase';

class AuthState {
	session = $state<Session | null>(null);
	ready = $state(false);
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
	supabase.auth.onAuthStateChange((_event, session) => {
		auth.session = session;
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
