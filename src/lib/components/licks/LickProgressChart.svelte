<script lang="ts">
	import type { LickProgressPoint } from '$lib/types/lick-practice';
	import {
		ALL_KEYS,
		allKeysUnlockedAt,
		bpmAxisRange,
		bpmBandSlices,
		collapseUnlockMarkers,
		currentLickPhase,
		lickPhase,
		phaseDisplay,
		unlockEvents,
		unlockMarkerLabel,
		type UnlockMarker
	} from '$lib/difficulty/lick-phase';

	interface Props {
		/** Per-lick progress samples (any order; sorted here). */
		points: LickProgressPoint[];
	}
	let { points }: Props = $props();

	const sorted = $derived([...points].sort((a, b) => a.t - b.t));

	// SVG geometry. The x-axis is scaled by real elapsed time, so a months-long
	// gap reads wider than a same-day one.
	const W = 400;
	const H = 120;
	const PAD_L = 26;
	const PAD_R = 6;
	const PAD_T = 8;
	const PAD_B = 8;
	const chartW = W - PAD_L - PAD_R;
	const chartH = H - PAD_T - PAD_B;

	const firstT = $derived(sorted[0]?.t ?? 0);
	const lastT = $derived(sorted[sorted.length - 1]?.t ?? firstT);

	// X position from a sample's timestamp within [firstT, lastT]. A zero span
	// (single point or all-same-time) pins to the left edge.
	function xAt(t: number): number {
		const span = lastT - firstT;
		return PAD_L + (span > 0 ? ((t - firstT) / span) * chartW : 0);
	}

	// Auto-scaled, 10-BPM-snapped range that reaches for the next phase threshold
	// when it's close — so a flat line doesn't glue to an edge and the band you're
	// climbing toward stays on the panel.
	const axis = $derived(bpmAxisRange(sorted.map((p) => p.bpm)));
	function bpmY(v: number): number {
		return PAD_T + chartH - ((v - axis.lo) / (axis.hi - axis.lo)) * chartH;
	}
	const bpmLine = $derived(sorted.map((p) => `${xAt(p.t)},${bpmY(p.bpm)}`).join(' '));

	// ── Phase bands ──
	// The "new" phase is decided by key coverage, not tempo, so it's a *vertical*
	// wash over the era before the 12th key: during it the lick is new whatever
	// the tempo says. The tempo bands are clipped to start where that era ends.
	const fullKeysT = $derived(allKeysUnlockedAt(sorted));
	const newEndX = $derived(fullKeysT == null ? PAD_L + chartW : xAt(fullKeysT));
	const newWidth = $derived(newEndX - PAD_L);
	const newPhase = phaseDisplay('new');

	const bandLeft = $derived(Math.max(PAD_L, newEndX));

	// ── Band labels ──
	// Set inside the band, but the tempo line runs through the same space. Each
	// label picks the end of its band where the line is farthest away, so the
	// data crosses the wash, not the words.
	const MIN_LABEL_H = 11;
	const LABEL_FONT = 7.5;
	/** Width per uppercase char at LABEL_FONT, including the 0.6 letter-spacing. */
	const LABEL_CHAR_W = 5.2;

	/** Tempo-line y at an x — the series is time-sorted, so x is monotonic. */
	function lineYAt(x: number): number {
		if (sorted.length === 0) return PAD_T + chartH;
		for (let i = 1; i < sorted.length; i++) {
			const x0 = xAt(sorted[i - 1].t);
			const x1 = xAt(sorted[i].t);
			if (x <= x1) {
				const span = x1 - x0;
				const f = span > 0 ? Math.min(1, Math.max(0, (x - x0) / span)) : 0;
				return bpmY(sorted[i - 1].bpm) + f * (bpmY(sorted[i].bpm) - bpmY(sorted[i - 1].bpm));
			}
		}
		return bpmY(sorted[sorted.length - 1].bpm);
	}

	/** How far the tempo line stays from a label box spanning [x0, x1] at `midY`. */
	function lineClearance(x0: number, x1: number, midY: number): number {
		let worst = Infinity;
		for (let i = 0; i <= 4; i++) {
			worst = Math.min(worst, Math.abs(lineYAt(x0 + ((x1 - x0) * i) / 4) - midY));
		}
		return worst;
	}

	interface PlacedLabel {
		text: string;
		x: number;
		y: number;
		anchor: 'start' | 'end';
	}

	/**
	 * Place a label inside [regionLo, regionHi] at baseline `y`, flush left or
	 * right — whichever end the tempo line clears by more. Null when the region
	 * is too narrow for the text.
	 */
	function placeLabel(text: string, regionLo: number, regionHi: number, y: number): PlacedLabel | null {
		const width = text.length * LABEL_CHAR_W;
		if (regionHi - regionLo < width + 8) return null;
		const midY = y - LABEL_FONT / 2 + 1;
		const leftClear = lineClearance(regionLo + 3, regionLo + 3 + width, midY);
		const rightClear = lineClearance(regionHi - 3 - width, regionHi - 3, midY);
		return rightClear > leftClear
			? { text, x: regionHi - 3, y, anchor: 'end' }
			: { text, x: regionLo + 3, y, anchor: 'start' };
	}

	const tempoBands = $derived(
		bpmBandSlices(axis.lo, axis.hi).map((slice) => {
			const yTop = bpmY(slice.to);
			const height = bpmY(slice.from) - yTop;
			const display = phaseDisplay(slice.phase);
			return {
				...display,
				y: yTop,
				height,
				// Set just inside the band's ceiling — but only when the band has
				// the vertical room for it.
				placed:
					height >= MIN_LABEL_H
						? placeLabel(display.label, bandLeft, W - PAD_R, yTop + 8.5)
						: null
			};
		})
	);

	const newLabel = $derived(
		newWidth > 0 ? placeLabel(newPhase.label, PAD_L, newEndX, PAD_T + 8.5) : null
	);

	// ── Key-unlock markers ──
	// One glyph per unlock, sitting above the tempo line at the tempo it happened.
	// Markers that would overlap collapse into one covering a range of keys.
	const MARKER_GAP = 13;
	const MARKER_LIFT = 9;
	const markers = $derived.by(() => {
		const raw: UnlockMarker[] = unlockEvents(sorted).map((e) => ({
			x: xAt(e.t),
			// Keep the glyph inside the panel when the line runs along the top edge.
			y: Math.max(bpmY(e.bpm) - MARKER_LIFT, PAD_T + 4),
			from: e.from,
			to: e.to
		}));
		return collapseUnlockMarkers(raw, MARKER_GAP);
	});

	const latest = $derived(sorted[sorted.length - 1]);
	const phase = $derived(currentLickPhase(sorted));
	const phaseInfo = $derived(phase ? phaseDisplay(phase) : null);

	function dateLabel(t: number): string {
		return new Date(t).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
	}

	/**
	 * The panel is an atomic image to assistive tech, so its `<title>` tooltips
	 * are never announced. The label carries what the retired keys panel used to
	 * state in text: how many keys this lick has earned.
	 */
	const chartAriaLabel = $derived.by(() => {
		const marked = markers.reduce((n, m) => n + (m.to - m.from), 0);
		const keys = `${Math.min(latest.keys, ALL_KEYS)} of ${ALL_KEYS} keys unlocked`;
		const unlocks = marked > 0 ? `, ${marked} of them marked on the line` : '';
		return `Tempo over time, banded by phase of expertise. ${keys}${unlocks}.`;
	});
</script>

{#snippet keyGlyph(color: string, opacity: number)}
	<!-- Key drawn in a local 14×8 box; scaled uniformly by the caller's transform. -->
	<g fill="none" stroke={color} stroke-width="1.5" stroke-linecap="round" {opacity}>
		<circle cx="3.2" cy="4" r="2.4" />
		<path d="M5.6 4 H12.4" />
		<path d="M9.4 4 V6.4" />
		<path d="M11.8 4 V6.9" />
	</g>
{/snippet}

{#if sorted.length === 0}
	<div class="rounded-lg border border-[var(--color-bg-tertiary)] py-6 text-center text-sm text-[var(--color-text-secondary)]">
		Practice this lick to start tracking your progress.
	</div>
{:else if sorted.length === 1}
	{@const only = sorted[0]}
	{@const info = phaseDisplay(lickPhase(only.bpm, only.keys))}
	<div class="rounded-lg border border-[var(--color-bg-tertiary)] px-4 py-5 text-center text-sm text-[var(--color-text-secondary)]">
		<span class="text-[var(--color-text)]">{only.bpm} BPM</span> ·
		<span class="smallcaps" style="color: {info.color}">{info.label}</span>
		{#if only.keys < ALL_KEYS}
			<span>({only.keys}/{ALL_KEYS} keys)</span>
		{/if}
		<div class="mt-1">Keep practicing to see a trend.</div>
	</div>
{:else}
	<div class="space-y-2">
		<div class="flex items-center justify-between text-xs">
			<span class="smallcaps text-[var(--color-text-secondary)]">Tempo</span>
			<span class="tabular-nums text-[var(--color-text-secondary)]">
				{#if phaseInfo}
					<span class="smallcaps" style="color: {phaseInfo.color}">{phaseInfo.label}</span> ·
				{/if}
				{latest.bpm} BPM now
			</span>
		</div>

		<svg
			viewBox="0 0 {W} {H}"
			class="w-full"
			role="img"
			aria-label={chartAriaLabel}
		>
			<!-- Tempo phase bands, clipped to after the lick left the "new" phase -->
			{#each tempoBands as band (band.phase)}
				<rect
					x={bandLeft}
					y={band.y}
					width={Math.max(0, W - PAD_R - bandLeft)}
					height={band.height}
					fill="color-mix(in srgb, {band.color} 14%, transparent)"
				/>
				{#if band.placed}
					<text
						x={band.placed.x}
						y={band.placed.y}
						text-anchor={band.placed.anchor}
						font-size={LABEL_FONT}
						letter-spacing="0.6"
						fill={band.color}
						opacity="0.9">{band.placed.text.toUpperCase()}</text
					>
				{/if}
			{/each}

			<!-- The "new" era: before all 12 keys were unlocked -->
			{#if newWidth > 0}
				<rect
					x={PAD_L}
					y={PAD_T}
					width={newWidth}
					height={chartH}
					fill="color-mix(in srgb, {newPhase.color} 20%, transparent)"
				/>
				{#if fullKeysT != null}
					<line
						x1={newEndX}
						y1={PAD_T}
						x2={newEndX}
						y2={PAD_T + chartH}
						stroke={newPhase.color}
						stroke-width="0.75"
						opacity="0.55"
					/>
				{/if}
				{#if newLabel}
					<text
						x={newLabel.x}
						y={newLabel.y}
						text-anchor={newLabel.anchor}
						font-size={LABEL_FONT}
						letter-spacing="0.6"
						fill={newPhase.color}
						opacity="0.9">{newLabel.text.toUpperCase()}</text
					>
				{/if}
			{/if}

			<!-- Axis rules: panel bounds plus any phase threshold inside them -->
			{#each [axis.lo, axis.hi] as v}
				{@const y = bpmY(v)}
				<line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="var(--color-bg-tertiary)" stroke-width="0.5" />
				<text x={PAD_L - 3} y={y + 3} text-anchor="end" font-size="8" class="fill-[var(--color-text-secondary)]">{v}</text>
			{/each}
			{#each tempoBands.slice(1) as band (band.phase)}
				<line
					x1={PAD_L}
					y1={band.y + band.height}
					x2={W - PAD_R}
					y2={band.y + band.height}
					stroke={band.color}
					stroke-width="0.5"
					opacity="0.5"
				/>
			{/each}

			<polyline
				fill="none"
				stroke="var(--color-accent)"
				stroke-width="2"
				stroke-linejoin="round"
				stroke-linecap="round"
				points={bpmLine}
			/>

			<!-- Key unlocks. Keyed by index: a series that dips and re-climbs can
			     produce two markers ending on the same key count. -->
			{#each markers as m, i (i)}
				<g transform="translate({Math.min(Math.max(m.x - 4.9, PAD_L), W - PAD_R - 9.8)}, {m.y - 5}) scale(0.7)">
					<title>{unlockMarkerLabel(m)}</title>
					{@render keyGlyph('var(--color-brass)', 0.85)}
				</g>
			{/each}
		</svg>

		<!-- X-axis: first / last session date, plus what the key glyph means -->
		<div
			class="flex items-center justify-between text-xs text-[var(--color-text-secondary)]"
			style="padding-left: {(PAD_L / W) * 100}%"
		>
			<span>{dateLabel(firstT)}</span>
			{#if markers.length > 0}
				<span class="flex items-center gap-1">
					<svg viewBox="0 0 14 8" class="h-2.5 w-[1.1rem]" aria-hidden="true">
						{@render keyGlyph('var(--color-brass)', 1)}
					</svg>
					key unlocked
				</span>
			{/if}
			<span>{dateLabel(lastT)}</span>
		</div>
	</div>
{/if}
