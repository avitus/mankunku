<script lang="ts">
	import ChordChart from './ChordChart.svelte';
	import { accuracyTierInfo } from '$lib/ui/score-colors';
	import type { InstrumentConfig } from '$lib/types/instruments';
	import type { PitchClass } from '$lib/types/music';
	import type { PlannedKey } from '$lib/state/lick-practice.svelte';

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
		/**
		 * True through the lead-in bar before the user's recording window
		 * opens. Pre-lights the active row's ring so the eye is already on the
		 * right chart when the switch lands, rather than hunting for it after.
		 */
		isArming?: boolean;
		/**
		 * Just-scored key result to flash as a tier-colored chip on that
		 * key's row (single-lick continuous flow — feedback rides the scroll
		 * instead of pausing it). Matched by key, so the chip follows its row
		 * and survives the stack swap when the key stays in rotation. `at`
		 * keys the fade animation so back-to-back flashes restart it.
		 */
		scoreFlash?: { key: PitchClass; score: number; at: number } | null;
		instrument: InstrumentConfig;
	}

	let {
		plannedKeys,
		scrollFraction,
		currentBeat,
		isPlaying,
		isRecording,
		isDemoing = false,
		isArming = false,
		scoreFlash = null,
		instrument
	}: Props = $props();

	// Each row is a fixed pixel height so the scroll math is simple.
	// Tuned to fit a single chord-chart row + padding.
	const ROW_HEIGHT = 105;
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
				{#if i === 0}
				<div class="row-label">
					{#if isCurrent && isDemoing}
						<span class="listen-tag">Listen</span>
					{/if}
					<span class="lick-name">{pk.lickName}</span>
				</div>
				{/if}
				<!-- Recording ring wraps just the chord chart, not the row
				     label, so the ring sits below the label rather than above
				     it. Dashed while arming, solid once the mic is live — a
				     shape change, so the state reads without relying on colour. -->
				<div
					class="chart-wrap"
					class:recording={isCurrent && isRecording}
					class:arming={isCurrent && isArming && !isRecording}
				>
					<ChordChart
						harmony={pk.harmony}
						currentBeat={isCurrent ? currentBeat : 0}
						timeSignature={[4, 4]}
						isPlaying={isCurrent && isPlaying}
						key={pk.key}
						{instrument}
					/>
					{#if scoreFlash && scoreFlash.key === pk.key}
						{@const tier = accuracyTierInfo(scoreFlash.score)}
						{#key scoreFlash.at}
							<div
								class="score-flash"
								style="--flash-color: {tier.color};"
								aria-live="polite"
							>
								{Math.round(scoreFlash.score * 100)}%
							</div>
						{/key}
					{/if}
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
		position: relative;
		padding: 0.25rem 0.5rem 0.5rem;
		opacity: 0.35;
		transition: opacity 250ms ease;
	}
	.row.current {
		opacity: 1;
	}
	.chart-wrap {
		position: relative;
		border-radius: 0.5rem;
	}
	/* Live mic — the recording-booth red the rest of the app uses for "on air". */
	.chart-wrap.recording {
		box-shadow: 0 0 0 2px var(--color-onair);
	}
	/* Lead-in: same ring, dashed and dimmed, so the row the user is about to
	   play is already marked a bar before the switch. */
	.chart-wrap.arming {
		outline: 2px dashed color-mix(in srgb, var(--color-onair) 55%, transparent);
		outline-offset: 0;
	}
	/* Transient per-key score chip: fades in over the just-scored row, holds,
	   fades out — sized and placed to never obscure the chord boxes' text. */
	.score-flash {
		position: absolute;
		top: 0.4rem;
		right: 0.6rem;
		padding: 0.15rem 0.5rem;
		border-radius: 0.375rem;
		font-size: 0.85rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--flash-color);
		background: color-mix(in srgb, var(--flash-color) 18%, var(--color-bg));
		animation: score-flash-fade 2.2s ease forwards;
		pointer-events: none;
	}
	@keyframes score-flash-fade {
		0% {
			opacity: 0;
			transform: translateY(-3px);
		}
		10% {
			opacity: 1;
			transform: translateY(0);
		}
		75% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}
	.row-label {
		position: absolute;
		top: -1rem;
		left: 0.5rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.listen-tag {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary);
	}
	.lick-name {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}
</style>
