<script lang="ts">
	import type { NoteResult } from '$lib/types/scoring.ts';
	import { midiToDisplayName } from '$lib/music/notation.ts';

	interface Props {
		noteResults: NoteResult[];
	}

	let { noteResults }: Props = $props();

	// Filter to only show matched and missed notes (not extras)
	const displayResults = $derived(noteResults.filter((r) => !r.extra));

	function pitchColor(r: NoteResult): string {
		if (r.missed) return 'var(--color-error)';
		if (r.pitchScore >= 0.9) return 'var(--color-success)';
		if (r.pitchScore >= 0.5) return 'var(--color-warning)';
		return 'var(--color-error)';
	}
</script>

{#if displayResults.length > 0}
	<div class="space-y-1">
		<div class="text-xs font-medium text-[var(--color-text-secondary)]">Note Comparison</div>
		<div class="grid grid-cols-[auto_1fr_1fr_auto_auto] gap-x-3 gap-y-0.5 text-xs">
			<!-- Header -->
			<span class="text-[var(--color-text-secondary)]">#</span>
			<span class="text-[var(--color-text-secondary)]">Expected</span>
			<span class="text-[var(--color-text-secondary)]">Played</span>
			<span class="text-right text-[var(--color-text-secondary)]">Pitch</span>
			<span class="text-right text-[var(--color-text-secondary)]">Rhythm</span>

			{#each displayResults as result, i}
				<span class="tabular-nums text-[var(--color-text-secondary)]">{i + 1}</span>
				<span class="font-mono">
					{result.expected.pitch !== null ? midiToDisplayName(result.expected.pitch) : 'rest'}
				</span>
				<span class="font-mono" style="color: {pitchColor(result)}">
					{#if result.missed}
						--
					{:else if result.detected}
						{midiToDisplayName(result.detected.midi)}
					{/if}
				</span>
				<span class="text-right tabular-nums" style="color: {pitchColor(result)}">
					{result.missed ? '0' : Math.round(result.pitchScore * 100)}%
				</span>
				<span
					class="text-right tabular-nums"
					style="color: {result.missed ? 'var(--color-error)' : result.rhythmScore >= 0.7 ? 'var(--color-success)' : 'var(--color-warning)'}"
				>
					{result.missed ? '0' : Math.round(result.rhythmScore * 100)}%
				</span>
			{/each}
		</div>
	</div>
{/if}
