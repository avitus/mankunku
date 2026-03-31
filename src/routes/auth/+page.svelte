<!--
  Login and Registration Page — /auth
  
  Dual-mode form for signing in and signing up with email/password,
  plus an OAuth "Continue with Google" button. Uses SvelteKit form actions
  with progressive enhancement via `enhance`.
  
  @see AAP §0.5.1 Group 3 (Auth Routes)
  @see AAP §0.5.3 (Auth Page UI)
  @see AAP §0.7.2 (Svelte 5 runes)
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';

	/** Toggle between "Sign In" (false) and "Sign Up" (true) modes */
	let isSignUp = $state(false);

	/** Tracks form submission state for loading indicator */
	let loading = $state(false);

	/** Error from OAuth callback URL query parameter (?error=...) */
	const errorMessage = $derived(page.url?.searchParams.get('error') ?? null);

	/** Form action results from fail() calls in +page.server.ts */
	const form = $derived(page.form);

	/**
	 * Decode OAuth callback error codes into user-friendly messages.
	 * Errors arrive as URL query parameters from the callback route.
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
			<h1 class="text-2xl font-bold">
				{isSignUp ? 'Create Account' : 'Welcome Back'}
			</h1>
			<p class="text-sm text-[var(--color-text-secondary)]">
				{isSignUp
					? 'Start your jazz ear training journey'
					: 'Sign in to sync your progress'}
			</p>
		</div>

		<!-- Error display — shows both form action errors and OAuth callback errors -->
		{#if form?.error || errorMessage}
			<div
				class="rounded-lg bg-[var(--color-error)]/10 px-4 py-3 text-sm text-[var(--color-error)]"
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

		<!-- Divider -->
		<div class="relative">
			<div class="absolute inset-0 flex items-center">
				<div class="w-full border-t border-[var(--color-bg-tertiary)]"></div>
			</div>
			<div class="relative flex justify-center text-xs">
				<span class="bg-[var(--color-bg)] px-3 text-[var(--color-text-secondary)]">or</span>
			</div>
		</div>

		<!-- OAuth Google button -->
		<form method="POST" action="?/oauth" use:enhance>
			<button
				type="submit"
				class="flex w-full items-center justify-center gap-3 rounded-lg bg-[var(--color-bg-tertiary)] py-2.5 text-sm font-medium transition-colors hover:opacity-80"
			>
				<svg class="h-5 w-5" viewBox="0 0 24 24">
					<path
						fill="#4285F4"
						d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
					/>
					<path
						fill="#34A853"
						d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
					/>
					<path
						fill="#FBBC05"
						d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
					/>
					<path
						fill="#EA4335"
						d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
					/>
				</svg>
				Continue with Google
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
