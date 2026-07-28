<script lang="ts" module>
	import type { PitchClass } from '$lib/types/music';
	import type { MasteryTier } from '$lib/tunes/lick-matcher';

	export interface CueEntry {
		id: string;
		/** Local key of the insertion point, in the user's WRITTEN pitch. */
		writtenKey: PitchClass;
		progressionLabel: string;
		/** Tune-key degree of the local key ('1' hidden, '4' shown as "the IV area"). */
		degreeLabel: string;
		lickName: string | null;
		mastery: MasteryTier | null;
		/** Whole bars until the window opens; <= 0 while it is open. */
		barsUntil: number;
	}
</script>

<script lang="ts">
	interface Props {
		entries: CueEntry[];
		isRecording: boolean;
		/** From strictnessKnobs: full cues, reduced (names on approach), or none. */
		cueLevel: 'full' | 'reduced' | 'none';
	}

	let { entries, isRecording, cueLevel }: Props = $props();

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

	function showName(entry: CueEntry): boolean {
		if (cueLevel === 'full') return true;
		return entry.barsUntil <= 2;
	}
</script>

{#if cueLevel !== 'none' && entries.length > 0}
	<div class="space-y-2" data-testid="insertion-cue-strip">
		{#each entries as entry, i (entry.id)}
			<div
				class="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors
					{i === 0 && entry.barsUntil <= 0
						? 'bg-[var(--color-bg-tertiary)] ring-1 ring-[var(--color-brass)]'
						: 'bg-[var(--color-bg-secondary)]'}"
			>
				<span
					class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg)] text-sm font-bold text-[var(--color-brass)]"
				>
					{entry.writtenKey}
				</span>
				<div class="min-w-0 flex-1">
					<div class="flex items-baseline gap-2">
						<span class="text-sm font-medium">{entry.progressionLabel}</span>
						{#if entry.degreeLabel !== '1'}
							<span class="text-xs text-[var(--color-text-secondary)]">({entry.degreeLabel} of the key)</span>
						{/if}
					</div>
					{#if entry.lickName && showName(entry)}
						<div class="flex items-center gap-2 truncate text-xs text-[var(--color-text-secondary)]">
							<span class="truncate">{entry.lickName}</span>
							{#if entry.mastery}
								<span
									class="smallcaps shrink-0 rounded-full border px-1.5 py-px text-[10px]"
									style="color: {MASTERY_COLORS[entry.mastery]}; border-color: {MASTERY_COLORS[entry.mastery]}"
								>
									{MASTERY_LABELS[entry.mastery]}
								</span>
							{/if}
						</div>
					{/if}
				</div>
				<div class="shrink-0 text-right text-xs text-[var(--color-text-secondary)]">
					{#if entry.barsUntil <= 0 && i === 0}
						{#if isRecording}
							<span class="flex items-center gap-1.5 font-medium text-[var(--color-onair)]">
								<span class="h-2 w-2 animate-pulse rounded-full bg-[var(--color-onair)]"></span>
								Play!
							</span>
						{:else}
							<span class="font-medium text-[var(--color-brass)]">Now</span>
						{/if}
					{:else if entry.barsUntil === 1}
						next bar
					{:else}
						in {entry.barsUntil} bars
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}
