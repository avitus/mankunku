// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { SupabaseClient, Session, User } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';

declare global {
	namespace App {
		interface Error {
			message: string;
			status?: number;
		}
		interface Locals {
			supabase: SupabaseClient<Database>;
			/**
			 * `degraded: true` means auth verification was UNAVAILABLE (network /
			 * backend failure) rather than negative — a null user then carries no
			 * signed-out verdict and must not trigger client-side data wipes.
			 */
			safeGetSession: () => Promise<{
				session: Session | null;
				user: User | null;
				degraded: boolean;
			}>;
		}
		interface PageData {
			session: Session | null;
			user: User | null;
			isAdmin: boolean;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
