<!--
  Choose a New Password — /auth/reset-password

  Where a password-recovery link lands once /auth/callback has exchanged its
  code. Shows the new-password form on a session, or says why the link
  failed and how to get a new one (requests are made from Settings).
-->
<script lang="ts">
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

	const inputClass =
		'w-full rounded-lg bg-[var(--color-bg-tertiary)] px-4 py-2.5 text-sm placeholder-[var(--color-text-secondary)]/50 outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)] transition-shadow';
</script>

<svelte:head>
	<title>Reset Password — Mankunku</title>
</svelte:head>

<div class="flex min-h-[70vh] items-center justify-center px-4">
	<div class="w-full max-w-md space-y-6">
		<div class="text-center space-y-2">
			<div class="font-display text-3xl font-bold tracking-tight text-[var(--color-text)]" style="letter-spacing: 0.02em;">
				MANKUNKU
			</div>
			<div class="jazz-rule mx-auto max-w-[120px]"></div>
			<h1 class="font-display text-3xl font-semibold pt-2">
				{form?.success ? 'Password Updated' : 'Choose a New Password'}
			</h1>
			{#if data.status === 'ready' && data.email && !form?.success}
				<p class="text-sm italic text-[var(--color-text-secondary)]">For {data.email}</p>
			{/if}
		</div>

		{#if form?.success}
			<div
				class="rounded-lg bg-[var(--color-bg-tertiary)] px-4 py-3 text-sm"
				role="status"
				data-testid="reset-password-success"
			>
				Your password has been changed. Use it the next time you sign in.
			</div>
		{:else if data.status === 'ready'}
			{#if form?.error}
				<div
					class="rounded-lg bg-[var(--color-error)]/10 px-4 py-3 text-sm text-[var(--color-error-text)]"
					role="alert"
				>
					{form.error}
				</div>
			{/if}

			<form
				method="POST"
				action="?/update"
				use:enhance={() => {
					saving = true;
					return async ({ update }) => {
						saving = false;
						await update();
					};
				}}
				class="space-y-4"
			>
				<!-- Lets password managers file the new password under the right account. -->
				<input type="email" autocomplete="username" value={data.email ?? ''} hidden readonly />

				<div class="space-y-1.5">
					<label for="password" class="block text-sm font-medium">New password</label>
					<input
						id="password"
						name="password"
						type="password"
						required
						minlength={6}
						autocomplete="new-password"
						class={inputClass}
					/>
				</div>

				<div class="space-y-1.5">
					<label for="confirm" class="block text-sm font-medium">Confirm new password</label>
					<input
						id="confirm"
						name="confirm"
						type="password"
						required
						minlength={6}
						autocomplete="new-password"
						class={inputClass}
					/>
				</div>

				<button
					type="submit"
					disabled={saving}
					class="w-full rounded-lg bg-[var(--color-accent)] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
				>
					{saving ? 'Saving…' : 'Set New Password'}
				</button>
			</form>
		{:else}
			<div
				class="rounded-lg bg-[var(--color-error)]/10 px-4 py-3 text-sm text-[var(--color-error-text)]"
				role="alert"
				data-testid="reset-password-problem"
				data-status={data.status}
			>
				{PROBLEMS[data.status]}
			</div>
			{#if data.status !== 'unavailable'}
				<p class="text-center text-sm text-[var(--color-text-secondary)]">
					{#if data.email}
						<a href="/settings" class="font-medium text-[var(--color-accent)] hover:underline">
							Request a new link from Settings
						</a>
					{:else}
						<a href="/auth" class="font-medium text-[var(--color-accent)] hover:underline">Sign in</a>,
						then request a new link from Settings.
					{/if}
				</p>
			{/if}
		{/if}

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
