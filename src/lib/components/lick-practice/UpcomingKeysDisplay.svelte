<script lang="ts">
	import ChordChart from './ChordChart.svelte';
	import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
	import { accuracyTierInfo } from '$lib/ui/score-colors';
	import { keyStackLayout } from '$lib/ui/key-stack-layout';
	import { noteIndexAtBeat } from '$lib/music/beat-cursor';
	import { leadSheetTuneFor, leadSheetAbcOptions } from '$lib/music/lead-sheet';
	import { phaseTabView, PHASE_LEAD_BEATS, type PhaseCue } from '$lib/state/lick-practice-phase';
	import { concertKeyToWritten } from '$lib/music/transposition';
	import { keyLabel } from '$lib/music/notation';
	import { lickMode } from '$lib/music/mode';
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
		 * Listen/play cue for the phase tab pinned to the active row: brass
		 * LISTEN while the app plays, on-air PLAY (with a countdown and the
		 * entry key) while the user does, "Straight in" through a turnaround
		 * that opens with no demo. Omit to render no tab.
		 */
		cue?: PhaseCue | null;
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
		cue = null,
		isArming = false,
		scoreFlash = null,
		instrument
	}: Props = $props();

	// Rows are fixed pixel heights so the scroll math is pure: one
	// chord-chart row, or the taller lead-sheet row a struggling key gets
	// (staff with chords above it, the beat strip and a caption beneath).
	const ROW_HEIGHT = 105;
	// Lead-sheet row budget: row padding 12 + tab clearance 26 + staff 110 +
	// beat strip 22 + slack. The staff box is clipped to its height so the
	// row can never overflow into the next one. No caption: the engraving
	// itself is the message, and a line of prose under it was clutter.
	const LEAD_ROW_HEIGHT = 178;
	const LEAD_STAFF_WIDTH = 1000;
	const VISIBLE_ROWS = 3;

	// The current key HOLDS one slot below the top for its whole duration —
	// the previous row (and its score flash) fully visible above it — and the
	// stack steps one row at each key change, eased by the CSS transition on
	// `.stack`. It does not drift: a staff crawling upward a pixel per frame
	// strobes. `keyStackLayout` owns the math for mixed heights. At session
	// start, the slot above row 0 is empty until the first key boundary
	// populates it.
	const rowHeights = $derived(plannedKeys.map((pk) => (pk.reveal ? LEAD_ROW_HEIGHT : ROW_HEIGHT)));
	const layout = $derived(keyStackLayout(rowHeights, scrollFraction, ROW_HEIGHT, VISIBLE_ROWS));
	const translateYpx = $derived(layout.translateY);
	const visualCurrentRow = $derived(layout.currentRow);

	// Lead sheets are built ONCE per stack (plannedKeys is set at lick/cycle
	// start), so each revealed row hands NotationDisplay the same tune and
	// options objects for its whole life — abcjs re-engraves on identity, and
	// a per-frame rebuild would redraw the staff sixty times a second.
	const leadSheets = $derived(
		plannedKeys.map((pk) => {
			if (!pk.reveal) return null;
			const sheet = leadSheetTuneFor(pk.phrase);
			return { ...sheet, options: leadSheetAbcOptions(pk.phrase, sheet.bars) };
		})
	);
	// The tab names the key of the row it sits on — that row is always the one
	// about to be played (the turnaround has already swapped the stack).
	const activeKeyLabel = $derived.by(() => {
		const key = plannedKeys[visualCurrentRow]?.key;
		if (!key) return '';
		const written = concertKeyToWritten(key, instrument);
		return keyLabel(written, lickMode(plannedKeys[visualCurrentRow].phrase));
	});
	const tab = $derived(cue ? phaseTabView(cue, activeKeyLabel) : null);
	const tabArm = $derived(
		tab && tab.count > 0 ? (PHASE_LEAD_BEATS + 1 - tab.count) / (PHASE_LEAD_BEATS + 1) : 0
	);
</script>

<!-- Persistent live region: the visible tab is destroyed and recreated when
     the stack swaps rows, and screen readers don't announce content that
     arrives by insertion — so the announcement lives on one stable element. -->
<span class="sr-only" role="status" aria-live="polite">
	{tab && tab.kind !== 'hidden' ? tab.text : ''}
</span>

<div class="viewport" style="height: {layout.viewportHeight}px;">
	<div class="stack" style="transform: translateY({translateYpx}px);">
		{#each plannedKeys as pk, i (pk.lickId + ':' + pk.key + ':' + i)}
			{@const isCurrent = i === visualCurrentRow}
			{@const sheet = leadSheets[i]}
			<div
				class="row"
				class:current={isCurrent}
				style="height: {rowHeights[i]}px;"
			>
				{#if i === 0}
				<div class="row-label">
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
					{#if sheet}
						<!-- Lead-sheet row: the key is under the floor, so the line is
						     engraved against its changes — chords above the staff, one
						     full-width system — with the beat strip beneath. The cursor
						     lights the note the band is at. No caption by decision: the
						     engraving is the message. -->
						{@const beatsPerBar = pk.phrase.timeSignature[0]}
						{@const cursor = isCurrent
							? noteIndexAtBeat(
									sheet.tune.sections[0].notes,
									currentBeat - sheet.startBar * beatsPerBar,
									pk.phrase.timeSignature
								)
							: null}
						<div class="lead-sheet" data-testid="lead-sheet-row">
							<NotationDisplay
								tune={sheet.tune}
								tuneOptions={sheet.options}
								{instrument}
								frameless
								staffWidth={LEAD_STAFF_WIDTH}
								cursorIndex={cursor}
							/>
						</div>
						<ChordChart
							harmony={pk.harmony}
							currentBeat={isCurrent ? currentBeat : 0}
							timeSignature={[4, 4]}
							isPlaying={isCurrent && isPlaying}
							key={pk.key}
							mode={lickMode(pk.phrase)}
							{instrument}
							dotsOnly
						/>
					{:else}
						<ChordChart
							harmony={pk.harmony}
							currentBeat={isCurrent ? currentBeat : 0}
							timeSignature={[4, 4]}
							isPlaying={isCurrent && isPlaying}
							key={pk.key}
							mode={lickMode(pk.phrase)}
							{instrument}
						/>
					{/if}
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
					<!-- Phase tab: the booth sign for the row the user is reading.
					     It rides the scroll for free (the row is its positioning
					     context) and covers the chart's "Changes" label, which is
					     the line the eye crosses on the way into the chords. -->
					{#if isCurrent && tab && tab.kind !== 'hidden'}
						<div class="phase-tab" data-kind={tab.kind} style="--arm: {tabArm};">
							<span class="tab-lamp" class:lit={tab.kind === 'play'} aria-hidden="true"></span>
							{#if tab.kind === 'play' || tab.kind === 'play-in'}
								<svg class="tab-glyph" viewBox="0 0 16 16" aria-hidden="true">
									<rect x="6" y="1.5" width="4" height="7.5" rx="2" fill="currentColor" />
									<path
										d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5"
										fill="none"
										stroke="currentColor"
										stroke-width="1.3"
										stroke-linecap="round"
									/>
								</svg>
							{:else if tab.kind === 'listen' || tab.kind === 'listen-in'}
								<svg class="tab-glyph" viewBox="0 0 16 16" aria-hidden="true">
									<path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" />
									<path
										d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9"
										fill="none"
										stroke="currentColor"
										stroke-width="1.3"
										stroke-linecap="round"
									/>
								</svg>
							{/if}
							<span class="smallcaps" aria-hidden="true">{tab.text}</span>
							{#if tab.count > 0}
								{#key tab.count}
									<span class="tab-count" aria-hidden="true">{tab.count}</span>
								{/key}
							{/if}
						</div>
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
		/* One eased step per key change; the rest of the time the stack is
		   perfectly still so the staff can be read. */
		transition: transform 420ms cubic-bezier(0.2, 0.7, 0.2, 1);
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
	/* Lead-sheet row: the staff is sized by HEIGHT so the row's pixel height
	   is fixed for the scroll math; a wide staff (LEAD_STAFF_WIDTH) makes the
	   single system span the row at that height, and on a narrow screen the
	   width cap letterboxes it smaller rather than taller. The box is clipped
	   so nothing can spill into the next row. The top padding keeps the phase
	   tab (pinned to the chart-wrap corner) off the clef and key signature.
	   abcjs's responsive mode sets the SVG to 100% width inline, hence the
	   !important. */
	.lead-sheet {
		box-sizing: border-box;
		height: 136px;
		padding: 26px 0.25rem 0;
		overflow: hidden;
	}
	.lead-sheet :global(svg) {
		display: block;
		height: 110px !important;
		width: auto !important;
		max-width: 100%;
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
	.lick-name {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	/* Phase tab — the listen/play booth sign pinned to the active row. Brass
	   is the band's colour (the app playing), on-air red is the live mic; the
	   solid background is deliberate so the tab owns its corner of the chart. */
	.phase-tab {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.18rem 0.55rem;
		border-radius: 0.45rem;
		border: 1px solid transparent;
		background: var(--color-bg);
		color: var(--color-text-secondary);
		transition:
			color 200ms ease,
			background-color 200ms ease,
			border-color 200ms ease;
	}
	/* Lead-in wash: opacity tracks the countdown via --arm, same idiom the
	   score components use — felt a bar early, read on the downbeat. */
	.phase-tab::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		pointer-events: none;
		opacity: 0;
		transition: opacity 200ms linear;
	}
	.phase-tab > * {
		position: relative;
	}
	.phase-tab[data-kind='listen'],
	.phase-tab[data-kind='listen-in'] {
		color: color-mix(in srgb, var(--color-brass) 70%, var(--color-text));
		background: color-mix(in srgb, var(--color-brass) 16%, var(--color-bg));
		border-color: color-mix(in srgb, var(--color-brass) 40%, transparent);
	}
	.phase-tab[data-kind='play-in'] {
		color: color-mix(in srgb, var(--color-onair) 70%, var(--color-text));
		background: color-mix(in srgb, var(--color-onair) 10%, var(--color-bg));
		border-color: color-mix(in srgb, var(--color-onair) 40%, transparent);
	}
	.phase-tab[data-kind='play-in']::before {
		background: color-mix(in srgb, var(--color-onair) 22%, transparent);
		opacity: var(--arm);
	}
	.phase-tab[data-kind='play'] {
		color: color-mix(in srgb, var(--color-onair) 70%, var(--color-text));
		background: color-mix(in srgb, var(--color-onair) 18%, var(--color-bg));
		border-color: color-mix(in srgb, var(--color-onair) 50%, transparent);
	}
	.tab-lamp {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-onair) 18%, var(--color-bg));
		box-shadow: inset 0 0 1px rgba(0, 0, 0, 0.6);
		transition:
			background-color 150ms ease,
			box-shadow 150ms ease;
	}
	.tab-lamp.lit {
		background: var(--color-onair);
		box-shadow:
			0 0 6px color-mix(in srgb, var(--color-onair) 80%, transparent),
			inset 0 0 1px rgba(255, 255, 255, 0.4);
	}
	.tab-glyph {
		flex: none;
		width: 0.85rem;
		height: 0.85rem;
	}
	.tab-count {
		display: inline-block;
		min-width: 0.9rem;
		text-align: center;
		font-size: 1.05rem;
		font-weight: 800;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		animation: tab-tick 220ms ease-out;
	}
	@keyframes tab-tick {
		from {
			opacity: 0.4;
			transform: scale(1.35);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.stack,
		.phase-tab,
		.phase-tab::before,
		.tab-lamp {
			transition: none;
		}
		.tab-count {
			animation: none;
		}
	}
</style>
