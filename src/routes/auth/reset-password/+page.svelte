<!--
  Choose a New Password — /auth/reset-password

  Where a password-recovery link lands once /auth/callback has exchanged its
  code. Shows the new-password form on a session, or says why the link
  failed and how to get a new one (requests are made from Settings).
-->
<script lang="ts">
	import '../auth.css';
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/** Tracks form submission state for the button label. */
	let saving = $state(false);

	/** Why the page can't show the form, keyed by load status. */
	const PROBLEMS: Record<Exclude<PageData['status'], 'ready'>, string> = {
		expired: 'This reset link has expired or has already been used.',
		'other-browser':
			'This reset link has to be opened in the same browser you requested it from.',
		invalid:
			"This reset link isn't valid. If you requested more than one, use the newest email.",
		'signed-out': 'Open the link in your password-reset email to choose a new password.',
		unavailable: "We couldn't verify your sign-in right now. Reload the page to try again."
	};

	let showPassword = $state(false);
	let showConfirm = $state(false);
</script>

<svelte:head>
	<title>Reset Password — Mankunku</title>
</svelte:head>

<div class="studio-desk auth-main">
	<div class="auth-stack">
		<section class="studio-panel auth-panel" aria-labelledby="reset-title">
			<header class="auth-heading">
				<p class="studio-label">Account recovery</p>
				<h1 id="reset-title">
					{form?.success ? 'Password updated' : data.status === 'ready' ? 'Choose a new password' : 'Reset your password'}<span aria-hidden="true">.</span>
				</h1>
				{#if data.status === 'ready' && data.email && !form?.success}
					<p>For {data.email}</p>
				{/if}
			</header>

			{#if form?.success}
				<div class="auth-notice" role="status" data-testid="reset-password-success">
					Your password has been changed. Use it the next time you sign in.
				</div>
			{:else if data.status === 'ready'}
				{#if form?.error}
					<div class="auth-notice auth-error" role="alert">{form.error}</div>
				{/if}

				<form method="POST" action="?/update" aria-busy={saving}
					use:enhance={() => {
						saving = true;
						return async ({ update }) => {
							try {
								await update();
							} finally {
								saving = false;
							}
						};
					}}
				>
					<!-- Identify the account for password managers. -->
					<input type="email" autocomplete="username" value={data.email ?? ''} hidden readonly />
					<div class="auth-field">
						<label for="password">New password</label>
						<div class="auth-password">
							<input id="password" name="password" type={showPassword ? 'text' : 'password'}
								required minlength={6} autocomplete="new-password" aria-describedby="password-hint"
								placeholder="Enter a new password" readonly={saving} />
							<button type="button" aria-label={showPassword ? 'Hide new password' : 'Show new password'}
								onclick={() => { showPassword = !showPassword; }} disabled={saving}>{showPassword ? 'Hide' : 'Show'}</button>
						</div>
						<small id="password-hint">At least 6 characters.</small>
					</div>
					<div class="auth-field">
						<label for="confirm">Confirm new password</label>
						<div class="auth-password">
							<input id="confirm" name="confirm" type={showConfirm ? 'text' : 'password'}
								required minlength={6} autocomplete="new-password" placeholder="Re-enter your new password" readonly={saving} />
							<button type="button" aria-label={showConfirm ? 'Hide confirmation' : 'Show confirmation'}
								onclick={() => { showConfirm = !showConfirm; }} disabled={saving}>{showConfirm ? 'Hide' : 'Show'}</button>
						</div>
					</div>
					<button type="submit" disabled={saving} class="studio-action auth-submit">
						{saving ? 'Saving…' : 'Set new password'}
						<span aria-hidden="true" class:auth-spinner={saving}>{saving ? '' : '→'}</span>
					</button>
				</form>
			{:else}
				<div class="auth-notice auth-error" role="alert" data-testid="reset-password-problem" data-status={data.status}>
					{PROBLEMS[data.status]}
				</div>
				{#if data.status !== 'unavailable'}
					<div class="auth-divider"></div>
					<p class="auth-switch">
						{#if data.email}
							<a href="/settings">Request a new link from Settings</a>
						{:else}
							<a href="/auth">Sign in</a>, then request a new link from Settings.
						{/if}
					</p>
				{/if}
			{/if}
		</section>
		<a class="auth-back" href="/">← Back to Mankunku</a>
		<p class="auth-signature">Yakhal’ Inkomo <span>·</span> Cry of the Bull</p>
	</div>
</div>
