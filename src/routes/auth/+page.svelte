<!--
  Login and Registration Page — /auth
  
  Dual-mode form for signing in and signing up with email/password. Uses
  SvelteKit form actions with progressive enhancement via `enhance`.

  Email/password is the only sign-in method — there is no social login.
-->
<script lang="ts">
	import './auth.css';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';

	/** Toggle between "Sign In" (false) and "Sign Up" (true) modes */
	let isSignUp = $state(false);
	let showPassword = $state(false);

	/** Tracks form submission state for loading indicator */
	let loading = $state(false);

	/** True while the in-flight submission is the resend button's, not the main submit */
	let resending = $state(false);

	/** Form action results from fail() calls and successes in +page.server.ts */
	const form = $derived(page.form);

	/**
	 * Error and notice from the callback route's URL query (?error=… / ?notice=…).
	 * A form result supersedes them: the query outlives the submissions made on
	 * this page, and "link expired" must not linger above "new link sent".
	 */
	const errorMessage = $derived(form ? null : (page.url?.searchParams.get('error') ?? null));
	const noticeParam = $derived(form ? null : (page.url?.searchParams.get('notice') ?? null));

	/**
	 * Decode callback error codes into user-friendly messages.
	 * Errors arrive as URL query parameters from /auth/callback, which
	 * handles the email-confirmation code exchange.
	 */
	function decodeErrorMessage(error: string | null): string {
		if (!error) return '';
		const messages: Record<string, string> = {
			callback_error: 'Authentication failed. Please try again.',
			link_expired:
				'That confirmation link has expired or was already used. Already confirmed? Just sign in. Otherwise, enter your email below to get a new link.',
			unknown: 'An unexpected error occurred.'
		};
		return messages[error] ?? 'An error occurred. Please try again.';
	}

	/** Success copy for the states that leave the user on this page */
	const notice = $derived.by(() => {
		// Supabase answers a signup for an already-confirmed address exactly
		// like a new one but mails nothing, so the copy covers both.
		if (form?.confirmationSent) {
			return `If ${form.email} is new here, we've emailed it a confirmation link: open it, then sign in. Already registered? Just sign in.`;
		}
		if (form?.resent) {
			return `If ${form.email} is waiting for confirmation, a new link is on its way. Use the newest email — older links stop working.`;
		}
		if (noticeParam === 'email_confirmed') {
			return 'Your email is confirmed. Sign in to continue.';
		}
		return null;
	});

	/**
	 * The resend button appears wherever an unconfirmed account could be stuck.
	 * Not straight after signup: the link was just sent, and Supabase refuses a
	 * second one to the same address for a minute.
	 */
	const offerResend = $derived(
		Boolean(form?.unconfirmed || form?.resent) ||
			errorMessage === 'link_expired' ||
			errorMessage === 'callback_error'
	);
</script>

<svelte:head>
	<title>{isSignUp ? 'Create Account' : 'Sign In'} — Mankunku</title>
</svelte:head>

<div class="studio-desk auth-main">
	<div class="auth-stack">
		<section class="studio-panel auth-panel" aria-labelledby="auth-title">
			<header class="auth-heading">
				<p class="studio-label">Your account</p>
				<h1 id="auth-title">{isSignUp ? 'Create an account' : 'Welcome back'}<span aria-hidden="true">.</span></h1>
				<p>{isSignUp ? 'Keep your practice and progress in sync.' : 'Sign in to sync your progress.'}</p>
			</header>

			{#if form?.error || errorMessage}
				<div class="auth-notice auth-error" role="alert">{form?.error ?? decodeErrorMessage(errorMessage)}</div>
			{/if}
			{#if notice}
				<div class="auth-notice" role="status">{notice}</div>
			{/if}

			<form method="POST" action={isSignUp ? '?/register' : '?/login'} aria-busy={loading}
				use:enhance={({ submitter }) => {
					loading = true;
					resending = submitter?.getAttribute('formaction') === '?/resend';
					return async ({ result, update }) => {
						if (result.type === 'redirect') {
							// The account changed. Start a fresh document at the target
							// so init reconciles storage before any route nodes load.
							// update() would reload the still-current /auth URL instead.
							// Keep this form busy until the destination replaces it.
							window.location.assign(result.location);
							return;
						}
						// A new account waits on its emailed link; the next thing the
						// user does here is sign in.
						if (result.type === 'success' && result.data?.confirmationSent) {
							// The kept password must not carry over into sign-in revealed.
							isSignUp = false;
							showPassword = false;
						}
						// No reset: a success that stays on this page (confirmation
						// sent, link resent) keeps the email the resend button reads.
						try {
							await update({ reset: false });
						} finally {
							loading = false;
							resending = false;
						}
					};
				}}
			>
				<div class="auth-field">
					<label for="email">Email</label>
					<input id="email" name="email" type="email" required autocomplete="email"
						value={form?.email ?? ''} placeholder="you@example.com" disabled={loading} />
				</div>
				<div class="auth-field">
					<label for="password">Password</label>
					<div class="auth-password">
						<input id="password" name="password" type={showPassword ? 'text' : 'password'} required
							autocomplete={isSignUp ? 'new-password' : 'current-password'}
							placeholder="Enter your password" minlength={isSignUp ? 6 : undefined}
							aria-describedby={isSignUp ? 'password-hint' : undefined} disabled={loading} />
						<button type="button" onclick={() => { showPassword = !showPassword; }}
							aria-label={showPassword ? 'Hide password' : 'Show password'}
							disabled={loading}>{showPassword ? 'Hide' : 'Show'}</button>
					</div>
					{#if isSignUp}<small id="password-hint">At least 6 characters.</small>{/if}
				</div>
				<button type="submit" disabled={loading} class="studio-action auth-submit">
					{loading && !resending ? (isSignUp ? 'Creating account…' : 'Signing in…') : (isSignUp ? 'Create account' : 'Sign in')}
					<span aria-hidden="true" class:auth-spinner={loading && !resending}>{loading && !resending ? '' : '→'}</span>
				</button>
				{#if offerResend}
					<!-- Resend uses only the email; password validation must not block it. -->
					<button type="submit" formaction="?/resend" formnovalidate disabled={loading} class="auth-resend">
						{resending ? 'Sending…' : 'Email me a new confirmation link'}
					</button>
				{/if}
			</form>
			<div class="auth-divider"></div>
			<p class="auth-switch">
				{isSignUp ? 'Already have an account?' : "Don't have an account?"}
				<button type="button" disabled={loading} onclick={() => { isSignUp = !isSignUp; showPassword = false; }}>
					{isSignUp ? 'Sign in' : 'Create account'}
				</button>
			</p>
		</section>
		<a class="auth-back" href="/">← Back to Mankunku</a>
		<p class="auth-signature">Yakhal’ Inkomo <span>·</span> Cry of the Bull</p>
	</div>
</div>
