<script lang="ts">
	import { page } from '$app/state';
	import EnclosureDetail from '$lib/components/tricks/EnclosureDetail.svelte';
	import TriadPairDetail from '$lib/components/tricks/TriadPairDetail.svelte';
	import { getTrickById } from '$lib/tricks';
	const trick = $derived(getTrickById(page.params.id ?? ''));
</script>

<svelte:head><title>{trick?.name ?? 'Trick'} — Mankunku</title></svelte:head>

{#if trick?.id === 'enclosures'}<EnclosureDetail />
{:else if trick?.id === 'triad-pairs'}<TriadPairDetail />
{:else}
	<div class="rounded-lg bg-[var(--color-bg-secondary)] p-8 text-center">
		<p>Trick not found: {page.params.id}</p>
		<a href="/tricks" class="mt-2 inline-block text-sm text-[var(--color-accent)]">Back to Tricks</a>
	</div>
{/if}
