<script lang="ts">
	import { onDestroy } from 'svelte';

	let { title, read }: { title: string; read: () => Promise<Blob | null> } = $props();
	let url = $state('');
	let loading = $state(false);
	let active = true;

	async function load(): Promise<void> {
		if (url || loading) return;
		loading = true;
		try {
			const file = await read();
			if (active && file) url = URL.createObjectURL(file);
		} finally {
			if (active) loading = false;
		}
	}

	onDestroy(() => {
		active = false;
		if (url) URL.revokeObjectURL(url);
	});
</script>

<details
	class="rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm"
	ontoggle={(event) => { if (event.currentTarget.open) void load(); }}
>
	<summary class="cursor-pointer text-[var(--color-text-secondary)]">Original PDF</summary>
	<div class="mt-2" aria-live="polite">
		{#if url}
			<a class="underline" href={url} download={`${title || 'Tune'}.pdf`}>Download original PDF</a>
		{:else if loading}
			Loading original PDF…
		{:else}
			The original PDF is unavailable. <button class="underline" onclick={load}>Try again</button>
		{/if}
	</div>
</details>
