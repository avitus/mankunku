import type { Session, User } from '@supabase/supabase-js';

/**
 * Application-specific user profile stored in the `user_profiles` database table.
 *
 * Maps to the PostgreSQL `public.user_profiles` table with snake_case columns;
 * the persistence/sync layer handles snake_case ↔ camelCase mapping.
 *
 * The `id` field references `auth.users.id` from Supabase Auth, serving as the
 * primary link between the authentication identity and application-specific data.
 */
export interface UserProfile {
	/** UUID primary key, references `auth.users.id` from Supabase Auth */
	id: string;

	/** User's chosen display name; nullable because email-only registrations may not provide one */
	displayName: string | null;

	/** URL to the user's avatar image, populated from OAuth provider or manual upload */
	avatarUrl: string | null;

	/** ISO 8601 timestamp of when the profile was created */
	createdAt: string;

	/** ISO 8601 timestamp of the most recent profile update */
	updatedAt: string;
}

/**
 * Client-side authentication state used by components and stores for
 * reactive auth-aware UI rendering.
 *
 * This interface is the primary contract consumed by layout components,
 * auth-gated pages, and state modules that trigger cloud synchronization.
 * Designed as a plain object interface for compatibility with Svelte 5
 * runes (`$state<AuthState>()`).
 */
export interface AuthState {
	/** Whether a valid authenticated session currently exists */
	isAuthenticated: boolean;

	/**
	 * The Supabase `User` object containing `id`, `email`, `app_metadata`,
	 * and `user_metadata`. Null when no user is authenticated.
	 */
	user: User | null;

	/**
	 * The Supabase `Session` object containing `access_token`, `refresh_token`,
	 * and `expires_at`. Null when no active session exists.
	 */
	session: Session | null;

	/**
	 * Application-specific user profile from the `user_profiles` table.
	 * Loaded separately from the Supabase `User` which only contains
	 * authentication metadata. Null before profile data is fetched or
	 * when no user is authenticated.
	 */
	profile: UserProfile | null;

	/**
	 * Indicates an in-progress authentication state transition such as
	 * initial session validation, login redirect, or token refresh.
	 * UI components should show loading indicators while this is `true`.
	 */
	loading: boolean;
}
