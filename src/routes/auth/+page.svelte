<!--
  Login and Registration Page — /auth
  
  Dual-mode form for signing in and signing up with email/password. Uses
  SvelteKit form actions with progressive enhancement via `enhance`.

  Email/password is the only sign-in method — there is no social login.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';

	/** Toggle between "Sign In" (false) and "Sign Up" (true) modes */
	let isSignUp = $state(false);

	/** Tracks form submission state for loading indicator */
	let loading = $state(false);

	/** Error from the callback route's URL query parameter (?error=...) */
	const errorMessage = $derived(page.url?.searchParams.get('error') ?? null);

	/** Form action results from fail() calls in +page.server.ts */
	const form = $derived(page.form);

	/**
	 * Decode callback error codes into user-friendly messages.
	 * Errors arrive as URL query parameters from /auth/callback, which
	 * handles the email-confirmation code exchange.
	 */
	function decodeErrorMessage(error: string | null): string {
		if (!error) return '';
		const messages: Record<string, string> = {
			callback_error: 'Authentication failed. Please try again.',
			unknown: 'An unexpected error occurred.'
		};
		return messages[error] ?? 'An error occurred. Please try again.';
	}
</script>

<svelte:head>
	<title>{isSignUp ? 'Create Account' : 'Sign In'} — Mankunku</title>
</svelte:head>

<div class="flex min-h-[70vh] items-center justify-center px-4">
	<div class="w-full max-w-md space-y-6">
		<!-- Header -->
		<div class="text-center space-y-2">
			<div class="font-display text-3xl font-bold tracking-tight text-[var(--color-text)]" style="letter-spacing: 0.02em;">
				MANKUNKU
			</div>
			<div class="smallcaps text-[var(--color-brass)]">Yakhal' Inkomo &middot; Cry of the Bull</div>
			<div class="jazz-rule mx-auto max-w-[120px]"></div>
			<h1 class="font-display text-3xl font-semibold pt-2">
				{isSignUp ? 'Create Account' : 'Welcome Back'}
			</h1>
			<p class="text-sm italic text-[var(--color-text-secondary)]">
				{isSignUp
					? 'Start your jazz ear training journey.'
					: 'Sign in to sync your progress.'}
			</p>
		</div>

		<!-- Error display — shows both form action errors and callback errors -->
		{#if form?.error || errorMessage}
			<div
				class="rounded-lg bg-[var(--color-error)]/10 px-4 py-3 text-sm text-[var(--color-error-text)]"
				role="alert"
			>
				{form?.error ?? decodeErrorMessage(errorMessage)}
			</div>
		{/if}

		<!-- Email / Password Form -->
		<form
			method="POST"
			action={isSignUp ? '?/register' : '?/login'}
			use:enhance={() => {
				loading = true;
				return async ({ update }) => {
					loading = false;
					await update();
				};
			}}
			class="space-y-4"
		>
			<!-- Email field -->
			<div class="space-y-1.5">
				<label for="email" class="block text-sm font-medium">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					required
					autocomplete="email"
					value={form?.email ?? ''}
					placeholder="you@example.com"
					class="w-full rounded-lg bg-[var(--color-bg-tertiary)] px-4 py-2.5 text-sm placeholder-[var(--color-text-secondary)]/50 outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)] transition-shadow"
				/>
			</div>

			<!-- Password field -->
			<div class="space-y-1.5">
				<label for="password" class="block text-sm font-medium">Password</label>
				<input
					id="password"
					name="password"
					type="password"
					required
					autocomplete={isSignUp ? 'new-password' : 'current-password'}
					placeholder="••••••••"
					minlength={isSignUp ? 6 : undefined}
					class="w-full rounded-lg bg-[var(--color-bg-tertiary)] px-4 py-2.5 text-sm placeholder-[var(--color-text-secondary)]/50 outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)] transition-shadow"
				/>
			</div>

			<!-- Submit button -->
			<button
				type="submit"
				disabled={loading}
				class="w-full rounded-lg bg-[var(--color-accent)] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
			>
				{#if loading}
					<span class="inline-flex items-center gap-2">
						<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
							<circle
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								stroke-width="4"
								class="opacity-25"
							/>
							<path
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
								class="opacity-75"
							/>
						</svg>
						{isSignUp ? 'Creating Account...' : 'Signing In...'}
					</span>
				{:else}
					{isSignUp ? 'Create Account' : 'Sign In'}
				{/if}
			</button>
		</form>

		<!-- Toggle sign-in / sign-up mode -->
		<p class="text-center text-sm text-[var(--color-text-secondary)]">
			{#if isSignUp}
				Already have an account?
				<button
					type="button"
					onclick={() => {
						isSignUp = false;
					}}
					class="font-medium text-[var(--color-accent)] hover:underline"
				>
					Sign In
				</button>
			{:else}
				Don't have an account?
				<button
					type="button"
					onclick={() => {
						isSignUp = true;
					}}
					class="font-medium text-[var(--color-accent)] hover:underline"
				>
					Create Account
				</button>
			{/if}
		</p>

		<!-- Back to app link -->
		<div class="text-center">
			<a
				href="/"
				class="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
			>
				← Back to Mankunku
			</a>
		</div>
	</div>
</div>
