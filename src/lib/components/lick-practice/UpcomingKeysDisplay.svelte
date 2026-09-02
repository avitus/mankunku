<script lang="ts">
	import ChordChart from './ChordChart.svelte';
	import NotationDisplay, {
		type RangeMarker
	} from '$lib/components/notation/NotationDisplay.svelte';
	import { accuracyTierInfo } from '$lib/ui/score-colors';
	import { keyStackLayout } from '$lib/ui/key-stack-layout';
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
		 * Scroll position in ROW units: the integer part is the row being
		 * played, the fraction the position within it (for a multi-pass row,
		 * `floor(fraction × passes) + 1` is the pass). The session converts the
		 * transport's slot-unit progress with `rowScrollFraction` before passing
		 * it, so a three-pass row holds through all its passes — raw key units
		 * would move that row after its first pass. Updated each animation frame.
		 */
		scrollFraction: number;
		/** Active beat in the currently-playing key (drives chord-box highlight). */
		currentBeat: number;
		/** True while the session is running. */
		isPlaying: boolean;
		/** True while the current key's recording window is open. */
		isRecording: boolean;
		/**
		 * Listen/play cue for the phase tab pinned to the active row: LISTEN
		 * (in the on-air red — red reads as "stop", i.e. don't play yet) while
		 * the app plays, PLAY (in brass, with a countdown and the entry key)
		 * while the user does, "Straight in" through a turnaround that opens
		 * with no demo. Omit to render no tab.
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
	// chord-chart row, or the taller lead-sheet row the key being learned
	// gets (staff with chords above it, the current bar marked on the staff).
	const ROW_HEIGHT = 105;
	// Lead-sheet row budget: row padding 12 + the staff box. The box is the
	// tab clearance (26) plus the engraving at full row width (measured:
	// 976 × 171 px for a 664 × 116.5 viewBox at LEAD_STAFF_WIDTH below),
	// clipped to its height so the row can never overflow into the next one.
	// No caption: the engraving itself is the message, and a line of prose
	// under it was clutter.
	const LEAD_STAFF_BOX = 200;
	const LEAD_ROW_HEIGHT = LEAD_STAFF_BOX + 12;
	// abcjs staff width in SVG units. The SVG is sized by WIDTH, so this is
	// the zoom: a 960 px row over a ~664-unit viewBox engraves at ~1.45× —
	// readable from a music stand, where the old 1000-unit staff was not.
	const LEAD_STAFF_WIDTH = 640;
	const VISIBLE_ROWS = 3;
	const NO_MARKERS: RangeMarker[] = [];

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
	// Which pass of a multi-pass (revealed) row is playing: the row spans its
	// passes as equal slots, so the fraction within the row says which one.
	const activePass = $derived.by(() => {
		const pk = plannedKeys[visualCurrentRow];
		if (!pk || pk.passes <= 1) return null;
		const frac = Math.max(0, scrollFraction) - visualCurrentRow;
		return { index: Math.min(pk.passes, Math.floor(frac * pk.passes) + 1), total: pk.passes };
	});

	// Current bar of the active row's lead sheet (0-based within the
	// engraved window), or -1 when the active row has no sheet or nothing is
	// playing. An INTEGER derived, so the marker array below only changes
	// identity when the bar changes — NotationDisplay redraws its playhead
	// rects on identity, and a per-frame array would churn the DOM at 60 fps.
	const activeBar = $derived.by(() => {
		const pk = plannedKeys[visualCurrentRow];
		const sheet = leadSheets[visualCurrentRow];
		if (!pk || !sheet || !isPlaying || currentBeat < 0) return -1;
		return Math.floor(currentBeat / pk.phrase.timeSignature[0]) - sheet.startBar;
	});
	// The playback marker, drawn ON the staff from abcjs's own bar geometry
	// (NotationDisplay's playhead range marker) — so it sits exactly under the
	// bar being played, whatever spacing the engraver chose.
	const activeMarkers = $derived<RangeMarker[]>(
		activeBar < 0
			? NO_MARKERS
			: [{ id: 'playhead', startBar: activeBar, endBarExclusive: activeBar + 1, status: 'playhead' }]
	);
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
							<!-- Lead-sheet row: the key being learned is under the floor, so
							     the line is engraved against its changes — chords above the
							     staff, one full-width system. The playhead under the staff
							     marks the bar, placed by the engraver's own geometry; it is
							     the only playback indication (a lit-note cursor was tried and
							     dropped as redundant). No caption by decision: the engraving
							     is the message. -->
							<div
								class="lead-sheet"
								data-testid="lead-sheet-row"
								style="--lead-staff-box: {LEAD_STAFF_BOX}px;"
							>
								<NotationDisplay
									tune={sheet.tune}
									tuneOptions={sheet.options}
									{instrument}
									frameless
									staffWidth={LEAD_STAFF_WIDTH}
									rangeMarkers={isCurrent ? activeMarkers : NO_MARKERS}
								/>
							</div>
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
							<div
								class="phase-tab"
								data-kind={tab.kind}
								data-pass={tab.kind === 'play' && activePass ? activePass.index : undefined}
								style="--arm: {tabArm};"
							>
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
								{#if tab.kind === 'play' && activePass}
									<!-- Pass n of the revealed key's three: read it, read it
									     again, then from memory. -->
									<span class="tab-pass" aria-hidden="true">
										· {activePass.index}/{activePass.total}
									</span>
								{/if}
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
	/* Live mic — the play-phase colour (brass): it is the user's turn. */
	.chart-wrap.recording {
		box-shadow: 0 0 0 2px var(--color-phase-play);
	}
	/* Lead-in: same ring, dashed and dimmed, so the row the user is about to
	   play is already marked a bar before the switch. */
	.chart-wrap.arming {
		outline: 2px dashed color-mix(in srgb, var(--color-phase-play) 55%, transparent);
		outline-offset: 0;
	}
	/* Lead-sheet row: the staff is sized by WIDTH like every other chart, so
	   LEAD_STAFF_WIDTH is the zoom — and never taller than the box, so a
	   phrase with ledger lines scales down (left-aligned, xMinYMin meet)
	   rather than clipping. The box is a fixed height for the scroll math and
	   clipped so nothing can spill into the next row. The top padding keeps
	   the phase tab (pinned to the chart-wrap corner) off the clef and key
	   signature. abcjs's responsive mode sets the SVG absolute inside an
	   aspect-ratio padding box, all inline — hence the !important on every
	   override. */
	.lead-sheet {
		box-sizing: border-box;
		height: var(--lead-staff-box);
		padding: 26px 0 0;
		overflow: hidden;
	}
	.lead-sheet :global(.abcjs-container) {
		display: block !important;
		padding-bottom: 0 !important;
		overflow: visible !important;
	}
	.lead-sheet :global(svg) {
		position: static !important;
		display: block;
		width: 100% !important;
		height: auto !important;
		max-height: calc(var(--lead-staff-box) - 26px);
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

	/* Phase tab — the listen/play booth sign pinned to the active row. The
	   phase tokens decide the colours (app.css): LISTEN in on-air red — red
	   reads as "stop", so it marks the phase in which the user must not play —
	   and PLAY in brass, the user's turn. The solid background is deliberate
	   so the tab owns its corner of the chart. */
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
		color: color-mix(in srgb, var(--color-phase-listen) 70%, var(--color-text));
		background: color-mix(in srgb, var(--color-phase-listen) 16%, var(--color-bg));
		border-color: color-mix(in srgb, var(--color-phase-listen) 40%, transparent);
	}
	.phase-tab[data-kind='play-in'] {
		color: color-mix(in srgb, var(--color-phase-play) 70%, var(--color-text));
		background: color-mix(in srgb, var(--color-phase-play) 10%, var(--color-bg));
		border-color: color-mix(in srgb, var(--color-phase-play) 40%, transparent);
	}
	.phase-tab[data-kind='play-in']::before {
		background: color-mix(in srgb, var(--color-phase-play) 22%, transparent);
		opacity: var(--arm);
	}
	.phase-tab[data-kind='play'] {
		color: color-mix(in srgb, var(--color-phase-play) 70%, var(--color-text));
		background: color-mix(in srgb, var(--color-phase-play) 18%, var(--color-bg));
		border-color: color-mix(in srgb, var(--color-phase-play) 50%, transparent);
	}
	.tab-lamp {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-phase-play) 18%, var(--color-bg));
		box-shadow: inset 0 0 1px rgba(0, 0, 0, 0.6);
		transition:
			background-color 150ms ease,
			box-shadow 150ms ease;
	}
	.tab-lamp.lit {
		background: var(--color-phase-play);
		box-shadow:
			0 0 6px color-mix(in srgb, var(--color-phase-play) 80%, transparent),
			inset 0 0 1px rgba(255, 255, 255, 0.4);
	}
	.tab-glyph {
		flex: none;
		width: 0.85rem;
		height: 0.85rem;
	}
	.tab-pass {
		font-size: 0.8rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		opacity: 0.85;
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
