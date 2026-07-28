<script lang="ts" module>
	import type { PitchClass } from '$lib/types/music';
	import type { MasteryTier } from '$lib/tunes/lick-matcher';

	export interface PickEntry {
		name: string;
		mastery: MasteryTier;
		/** Transposition target in the user's WRITTEN pitch. */
		writtenKey: PitchClass;
	}
</script>

<script lang="ts">
	interface Props {
		/** Ranked suggestions for the upcoming insertion point. */
		entries: PickEntry[];
		picked: number;
		onPick: (index: number) => void;
		/** Locked once the window is open — the take scores the pick made before it. */
		disabled?: boolean;
	}

	let { entries, picked, onPick, disabled = false }: Props = $props();

	const MASTERY_LABELS: Record<MasteryTier, string> = {
		known: 'Known',
		learning: 'Learning',
		unknown: 'New'
	};
	const MASTERY_COLORS: Record<MasteryTier, string> = {
		known: 'var(--color-success)',
		learning: 'var(--color-brass)',
		unknown: 'var(--color-text-secondary)'
	};
</script>

{#if entries.length > 0}
	<div class="rounded-lg bg-[var(--color-bg-secondary)] p-3" data-testid="suggestion-pick-card">
		<div class="mb-2 flex items-center gap-2">
			<span class="smallcaps text-xs text-[var(--color-brass)]">Pick your lick</span>
			<div class="jazz-rule flex-1"></div>
		</div>
		<div class="space-y-1">
			{#each entries as entry, i (i)}
				<button
					onclick={() => onPick(i)}
					{disabled}
					class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-60
						{picked === i
							? 'bg-[var(--color-accent)]/20 ring-1 ring-[var(--color-accent)]'
							: 'hover:bg-[var(--color-bg-tertiary)]'}"
				>
					<span class="w-4 shrink-0 text-xs text-[var(--color-text-secondary)]">{i + 1}</span>
					<span class="min-w-0 flex-1 truncate">{entry.name}</span>
					<span class="shrink-0 text-xs font-medium text-[var(--color-brass)]">{entry.writtenKey}</span>
					<span
						class="smallcaps shrink-0 rounded-full border px-1.5 py-px text-[10px]"
						style="color: {MASTERY_COLORS[entry.mastery]}; border-color: {MASTERY_COLORS[entry.mastery]}"
					>
						{MASTERY_LABELS[entry.mastery]}
					</span>
				</button>
			{/each}
		</div>
	</div>
{/if}
