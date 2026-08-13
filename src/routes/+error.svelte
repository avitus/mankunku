<script lang="ts">
	import { page } from '$app/state';

	/**
	 * Root error boundary. Before this existed the app had NO +error.svelte, so
	 * a navigation that failed non-recoverably (after handleNavErrorRecovery's
	 * one attempt per chunk) fell back to SvelteKit's bare default — or, worse,
	 * looked like a dead click. Retry does a full-page load of the CURRENT URL,
	 * which by this point is the navigation target, so it fetches a fresh HTML
	 * shell + manifest from the server — the same recovery hooks.client.ts
	 * performs automatically on the first failure.
	 */
	function retry() {
		location.reload();
	}
</script>

<svelte:head>
	<title>{page.status === 404 ? 'Page not found' : 'Something went wrong'} — Mankunku</title>
</svelte:head>

<div class="flex flex-col items-center gap-4 py-16 text-center">
	<h1 class="font-display text-4xl font-bold tracking-tight text-[var(--color-text)]">
		{page.status === 404 ? 'Page not found' : 'Something went wrong'}
	</h1>
	<p class="max-w-md text-sm text-[var(--color-text-secondary)]">
		{#if page.status === 404}
			There's nothing at <span class="break-all font-mono">{page.url.pathname}</span>.
		{:else}
			{page.error?.message ?? 'An unexpected error occurred.'}
			If this keeps happening, reloading usually picks up the latest version of the app.
		{/if}
	</p>
	<div class="flex items-center gap-3">
		{#if page.status !== 404}
			<button
				onclick={retry}
				class="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
			>
				Reload
			</button>
		{/if}
		<a
			href="/"
			class="rounded-md border border-[var(--color-bg-tertiary)] px-4 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text)]"
		>
			Back to Home
		</a>
	</div>
</div>
