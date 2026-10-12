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
						loading = false;
						resending = false;
						// A new account waits on its emailed link; the next thing the
						// user does here is sign in.
						if (result.type === 'success' && result.data?.confirmationSent) {
							isSignUp = false;
						}
						// No reset: a success that stays on this page (confirmation
						// sent, link resent) keeps the email the resend button reads.
						await update({ reset: false });
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
					<span aria-hidden="true">{loading && !resending ? '…' : '→'}</span>
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

<style>
	.auth-main {
		display: flex;
		justify-content: center;
		padding: 24px 0 0;
	}
	.auth-stack {
		width: 100%;
		max-width: 460px;
	}
	.auth-panel {
		padding: 36px 34px 28px;
	}
	.auth-heading {
		display: block;
		margin: 0 0 30px;
	}
	.auth-heading .studio-label {
		color: var(--color-brass);
		font-size: 10px;
	}
	.auth-heading h1 {
		font: 500 36px/1.15 var(--font-display);
		letter-spacing: -.035em;
		margin: 12px 0;
	}
	.auth-heading h1 span {
		color: var(--color-brass);
	}
	.auth-heading p:not(.studio-label) {
		color: var(--studio-muted);
		font-size: 13px;
		margin: 0;
	}
	.auth-field {
		margin-bottom: 20px;
	}
	.auth-field label {
		display: block;
		font-size: 12px;
		font-weight: 500;
		color: var(--studio-text);
		margin-bottom: 9px;
	}
	.auth-field input {
		box-sizing: border-box;
		display: block;
		width: 100%;
		height: 48px;
		background: var(--studio-well);
		border: 1px solid var(--studio-border);
		border-radius: 4px;
		color: var(--studio-text);
		font: inherit;
		font-size: 14px;
		padding: 12px 14px;
		box-shadow: inset 0 2px 4px #0003;
		outline: none;
	}
	.auth-field input::placeholder {
		color: var(--studio-muted);
		opacity: .8;
	}
	.auth-field input:focus {
		border-color: var(--color-brass);
		outline: 2px solid color-mix(in srgb,var(--color-brass) 35%,transparent);
		outline-offset: 2px;
	}
	.auth-field input:disabled {
		opacity: .55;
	}
	.auth-password {
		position: relative;
	}
	.auth-password input {
		padding-right: 68px;
	}
	.auth-password button {
		position: absolute;
		top: 2px;
		bottom: 2px;
		right: 2px;
		min-width: 56px;
		padding: 0 10px;
		color: var(--studio-muted);
		font-size: 11px;
		border: 0;
		background: transparent;
		border-radius: 3px;
		cursor: pointer;
	}
	.auth-password button:hover {
		color: var(--studio-text);
	}
	.auth-field small {
		display: block;
		margin-top: 8px;
		font-size: 11px;
		color: var(--studio-muted);
	}
	.auth-submit {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
		min-height: 48px;
		margin-top: 26px;
		padding: 13px 17px;
		font-size: 13px;
		background: var(--studio-button);
		border-color: var(--studio-border);
	}
	.auth-submit>span {
		font-size: 18px;
		font-weight: 400;
	}
	.auth-divider {
		height: 1px;
		background: color-mix(in srgb, var(--studio-border) 45%, transparent);
		margin: 26px 0 22px;
	}
	.auth-switch {
		font-size: 12px;
		color: var(--studio-muted);
		text-align: center;
		margin: 0;
		line-height: 1.8;
	}
	.auth-switch button {
		padding: 10px 2px;
		min-height: 44px;
		border: 0;
		background: transparent;
		color: var(--color-brass);
		font: inherit;
		font-weight: 500;
		font-size: 12px;
		cursor: pointer;
	}
	.auth-switch button:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.auth-back {
		display: block;
		width: fit-content;
		margin: 24px auto 0;
		color: var(--studio-muted);
		font-size: 12px;
		text-decoration: none;
		padding: 8px;
	}
	.auth-back:hover {
		color: var(--studio-text);
	}
	.auth-signature {
		text-align: center;
		margin: 26px 0 0;
		font-size: 9px;
		color: var(--studio-muted);
		letter-spacing: .1em;
		text-transform: uppercase;
	}
	.auth-signature span {
		color: var(--color-brass);
		margin: 0 5px;
	}
	button:focus-visible,.auth-back:focus-visible {
		outline: 2px solid var(--color-brass);
		outline-offset: 3px;
	}
	button:disabled {
		cursor: default;
		opacity: .55;
	}
	.auth-notice {
		border: 1px solid var(--studio-border);
		border-radius: 4px;
		padding: 12px 14px;
		background: var(--studio-well);
		color: var(--studio-text);
		font-size: 12px;
		line-height: 1.6;
		margin-bottom: 22px;
		overflow-wrap: anywhere;
	}
	.auth-error {
		color: var(--color-error-text);
		border-color: color-mix(in srgb,var(--color-error-text) 45%,transparent);
	}
	.auth-resend {
		width: 100%;
		border: 1px solid var(--studio-border);
		border-radius: 4px;
		background: transparent;
		color: var(--studio-text);
		font-size: 12px;
		padding: 12px;
		margin-top: 12px;
		min-height: 44px;
		cursor: pointer;
	}
	@media(max-width:600px) {
		.auth-main {
			padding: 6px 0 0;
		}
		.auth-panel {
			padding: 30px 22px 24px;
		}
		.auth-heading h1 {
			font-size: 32px;
		}
		.auth-heading {
			margin-bottom: 26px;
		}
		.auth-signature {
			margin-top: 20px;
		}
	}
	@media(prefers-reduced-motion:reduce) {
		* {
			transition: none!important;
			animation: none!important;
		}
	}
</style>
