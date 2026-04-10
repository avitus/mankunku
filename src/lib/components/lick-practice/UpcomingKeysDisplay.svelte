<script lang="ts">
	import ChordChart from './ChordChart.svelte';
	import { concertKeyToWritten } from '$lib/music/transposition.ts';
	import type { InstrumentConfig } from '$lib/types/instruments.ts';
	import type { PlannedKey } from '$lib/state/lick-practice.svelte.ts';

	interface Props {
		/** All keys for the current lick, in playback order. */
		plannedKeys: PlannedKey[];
		/**
		 * Continuous scroll position in "key units": 0 at the start of the
		 * first key, 1 at the start of the second key, etc. Updated each
		 * animation frame from transport.seconds.
		 */
		scrollFraction: number;
		/** Active beat in the currently-playing key (drives chord-box highlight). */
		currentBeat: number;
		/** True while the session is running. */
		isPlaying: boolean;
		/** True while the current key's recording window is open. */
		isRecording: boolean;
		/**
		 * True while the app is playing a continuous-mode demo before the
		 * user starts. The active row's chip switches from "Now" to "Listen"
		 * to signal that the user should listen, not play.
		 */
		isDemoing?: boolean;
		instrument: InstrumentConfig;
	}

	let {
		plannedKeys,
		scrollFraction,
		currentBeat,
		isPlaying,
		isRecording,
		isDemoing = false,
		instrument
	}: Props = $props();

	// Each row is a fixed pixel height so the scroll math is simple.
	// Tuned to fit a single chord-chart row + label + padding.
	const ROW_HEIGHT = 130;
	const VISIBLE_ROWS = 3;

	// One-row offset so the current key starts at viewport row 1 (one row
	// down from the top) and finishes its duration at viewport row 0. This
	// guarantees the chart for the active key is fully visible throughout
	// its entire duration — the previous key sits above it, sliding out
	// as the current key slides up. At session start, viewport row 0 is
	// empty until the first key boundary populates it with key 0.
	const translateYpx = $derived(
		(1 - Math.max(0, scrollFraction)) * ROW_HEIGHT
	);
	const visualCurrentRow = $derived(
		Math.min(plannedKeys.length - 1, Math.max(0, Math.floor(scrollFraction)))
	);
</script>

<div class="viewport" style="height: {ROW_HEIGHT * VISIBLE_ROWS}px;">
	<div class="stack" style="transform: translateY({translateYpx}px);">
		{#each plannedKeys as pk, i (pk.lickId + ':' + pk.key + ':' + i)}
			{@const isCurrent = i === visualCurrentRow}
			<div
				class="row"
				class:current={isCurrent}
				style="height: {ROW_HEIGHT}px;"
			>
				<div class="row-label">
					<span class="chip" class:chip-current={isCurrent}>
						{#if isCurrent}
							{isDemoing ? 'Listen' : 'Now'}
						{:else if i < visualCurrentRow}
							Done
						{:else}
							Up next
						{/if}
					</span>
					<span class="key-text">{concertKeyToWritten(pk.key, instrument)}</span>
					{#if i === 0}
						<span class="lick-name">{pk.lickName}</span>
					{/if}
				</div>
				<!-- Recording ring wraps just the chord chart, not the row
				     label, so the blue border sits below the label rather
				     than above it. -->
				<div class="chart-wrap" class:recording={isCurrent && isRecording}>
					<ChordChart
						harmony={pk.harmony}
						currentBeat={isCurrent ? currentBeat : 0}
						timeSignature={[4, 4]}
						isPlaying={isCurrent && isPlaying}
						{instrument}
					/>
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.viewport {
		position: relative;
		overflow: hidden;
		border-radius: 0.5rem;
	}
	.stack {
		display: flex;
		flex-direction: column;
		will-change: transform;
	}
	.row {
		padding: 0.5rem 0.5rem 0.75rem;
		opacity: 0.35;
		transition: opacity 250ms ease;
	}
	.row.current {
		opacity: 1;
	}
	.chart-wrap {
		border-radius: 0.5rem;
	}
	.chart-wrap.recording {
		box-shadow: 0 0 0 2px var(--color-accent);
	}
	.row-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}
	.chip {
		display: inline-block;
		padding: 0.15rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
	}
	.chip.chip-current {
		background: var(--color-accent);
		color: white;
	}
	.key-text {
		font-size: 1.125rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.lick-name {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}
</style>
