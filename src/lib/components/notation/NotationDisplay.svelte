<script lang="ts">
	import { onMount } from 'svelte';
	import type { Phrase } from '$lib/types/music';
	import type { InstrumentConfig } from '$lib/types/instruments';
	import { phraseToAbc } from '$lib/music/notation';

	interface Props {
		phrase: Phrase | null;
		instrument?: InstrumentConfig;
	}

	let { phrase, instrument }: Props = $props();

	let containerEl = $state<HTMLDivElement | undefined>(undefined);
	let abcjs = $state<typeof import('abcjs') | null>(null);

	onMount(async () => {
		abcjs = await import('abcjs');
	});

	$effect(() => {
		if (!abcjs || !containerEl || !phrase) return;

		const abc = phraseToAbc(phrase, instrument);
		abcjs.renderAbc(containerEl, abc, {
			responsive: 'resize',
			staffwidth: 600,
			paddingtop: 10,
			paddingbottom: 10,
			add_classes: true
		});
	});
</script>

<div class="notation-container rounded-lg bg-[var(--color-bg-secondary)] p-4">
	<!-- "Lead sheet" liner-note header — mirrors the typography of a Blue Note LP -->
	<div class="mb-2 flex items-center gap-2">
		<span class="smallcaps text-[var(--color-brass)]">Lead sheet</span>
		<div class="jazz-rule flex-1"></div>
	</div>
	{#if phrase}
		<div bind:this={containerEl} class="abcjs-container"></div>
	{:else}
		<div class="flex h-24 items-center justify-center italic text-[var(--color-text-secondary)]">
			No phrase loaded
		</div>
	{/if}
</div>

<style>
	.notation-container :global(svg) {
		width: 100%;
		max-width: 100%;
	}
	/* Style abcjs SVG for dark mode */
	.notation-container :global(svg path),
	.notation-container :global(svg line),
	.notation-container :global(svg rect:not(.abcjs-note_selected)) {
		stroke: var(--color-text) !important;
	}
	.notation-container :global(svg text) {
		fill: var(--color-text) !important;
	}
</style>
