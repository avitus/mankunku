/**
 * Phases of expertise for a single lick.
 *
 * A lick climbs through four phases as you practise it. The first is decided by
 * *coverage* (how many of the 12 keys you've unlocked), the rest by *tempo*:
 *
 *   new         — fewer than 12 keys unlocked, however fast you play it
 *   learning    — all 12 keys, below PROFICIENT_BPM
 *   proficient  — all 12 keys, PROFICIENT_BPM up to EXPERT_BPM
 *   expert      — all 12 keys, at or above EXPERT_BPM
 *
 * Reaching a threshold tempo promotes you (>= not >), so a 5-BPM bump that lands
 * exactly on 120 is the promotion it feels like.
 *
 * Phases are a *display* concept — nothing here gates practice, unlocks keys, or
 * moves tempo. Those rules live in `state/lick-practice.svelte.ts`.
 *
 * Colours come from the Mastery ramp (teal → brass), not the Difficulty ramp:
 * a phase is accomplishment earned, not how hard the material is.
 */

import type { LickProgressPoint } from '$lib/types/lick-practice';

export type LickPhase = 'new' | 'learning' | 'proficient' | 'expert';

/** Keys a lick must unlock to leave the "new" phase. */
export const ALL_KEYS = 12;
/** Tempo at which a fully-unlocked lick becomes "proficient". */
export const PROFICIENT_BPM = 120;
/** Tempo at which a fully-unlocked lick becomes "expert". */
export const EXPERT_BPM = 150;

export interface LickPhaseDisplay {
	phase: LickPhase;
	label: string;
	/** A `var(--mastery-N)` custom property — theme-aware, safe in inline `style`. */
	color: string;
}

/**
 * Mastery-ramp band per phase. Spread across the ramp so the four phases stay
 * distinguishable in both themes: deep teal (new) → brass (expert).
 */
const PHASE_MASTERY_BAND: Record<LickPhase, number> = {
	new: 2,
	learning: 4,
	proficient: 7,
	expert: 10
};

/** The tempo-driven phases, low to high, with the tempo each one starts at. */
const TEMPO_PHASES: readonly { phase: LickPhase; from: number }[] = [
	{ phase: 'learning', from: 0 },
	{ phase: 'proficient', from: PROFICIENT_BPM },
	{ phase: 'expert', from: EXPERT_BPM }
];

/** Resolve a lick's phase from its current tempo and unlocked-key count. */
export function lickPhase(bpm: number, keys: number): LickPhase {
	if (keys < ALL_KEYS) return 'new';
	if (bpm >= EXPERT_BPM) return 'expert';
	if (bpm >= PROFICIENT_BPM) return 'proficient';
	return 'learning';
}

/** Label + mastery-ramp colour for a phase. */
export function phaseDisplay(phase: LickPhase): LickPhaseDisplay {
	return { phase, label: phase, color: `var(--mastery-${PHASE_MASTERY_BAND[phase]})` };
}

/** Chronological copy of a progress series (stored order isn't guaranteed). */
function byTime(points: readonly LickProgressPoint[]): LickProgressPoint[] {
	return [...points].sort((a, b) => a.t - b.t);
}

/** Phase implied by the newest sample in a series, or null when there is none. */
export function currentLickPhase(points: readonly LickProgressPoint[]): LickPhase | null {
	const sorted = byTime(points);
	const latest = sorted[sorted.length - 1];
	return latest ? lickPhase(latest.bpm, latest.keys) : null;
}

/**
 * Timestamp of the first sample with the full key set — the moment the lick left
 * the "new" phase. Null while it is still unlocking keys.
 */
export function allKeysUnlockedAt(points: readonly LickProgressPoint[]): number | null {
	return byTime(points).find((p) => p.keys >= ALL_KEYS)?.t ?? null;
}

/** A key-unlock moment: the count went from `from` to `to` at time `t`. */
export interface UnlockEvent {
	t: number;
	/** Session tempo when the key unlocked — where the marker sits on the line. */
	bpm: number;
	from: number;
	to: number;
}

/**
 * Key unlocks witnessed by a progress series: every point where the count rose.
 * The first sample is never an unlock — a lick's history can start mid-climb
 * (the series was introduced after the lick had already earned keys), and a
 * marker there would claim credit for keys it never saw earned.
 */
export function unlockEvents(points: readonly LickProgressPoint[]): UnlockEvent[] {
	const sorted = byTime(points);
	const events: UnlockEvent[] = [];
	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1];
		const curr = sorted[i];
		if (curr.keys > prev.keys) {
			events.push({ t: curr.t, bpm: curr.bpm, from: prev.keys, to: curr.keys });
		}
	}
	return events;
}

/** A plotted unlock marker: chart coordinates plus the key range it covers. */
export interface UnlockMarker {
	x: number;
	y: number;
	from: number;
	to: number;
}

/**
 * Merge markers that would overlap into one, keeping the earliest position and
 * widening its key range. Gaps are measured against the last *kept* marker, so a
 * dense run of unlocks collapses into a single marker rather than a chain of
 * near-misses that each clear the gap only against their neighbour.
 */
export function collapseUnlockMarkers(
	markers: readonly UnlockMarker[],
	minGap: number
): UnlockMarker[] {
	const kept: UnlockMarker[] = [];
	for (const m of markers) {
		const last = kept[kept.length - 1];
		if (last && m.x - last.x < minGap) {
			last.to = Math.max(last.to, m.to);
		} else {
			kept.push({ ...m });
		}
	}
	return kept;
}

function ordinal(n: number): string {
	const rem100 = n % 100;
	if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
	switch (n % 10) {
		case 1:
			return `${n}st`;
		case 2:
			return `${n}nd`;
		case 3:
			return `${n}rd`;
		default:
			return `${n}th`;
	}
}

/** Tooltip text for a marker: one key by ordinal, several as a range. */
export function unlockMarkerLabel(marker: UnlockMarker): string {
	const first = marker.from + 1;
	return first === marker.to
		? `${ordinal(marker.to)} key unlocked`
		: `keys ${first}–${marker.to} unlocked`;
}

/**
 * Y-axis range for the tempo panel: padded and snapped to 10 BPM so a flat line
 * doesn't glue to an edge, then stretched up to the next phase threshold when it
 * is within reach — the band you're climbing toward stays visible without
 * squashing the data into a corner when it's still far off.
 */
const THRESHOLD_REACH_BPM = 20;

export function bpmAxisRange(values: readonly number[]): { lo: number; hi: number } {
	if (values.length === 0) return { lo: 0, hi: 100 };
	const lo = Math.max(0, Math.floor((Math.min(...values) - 10) / 10) * 10);
	let hi = Math.max(lo + 10, Math.ceil((Math.max(...values) + 10) / 10) * 10);
	for (const threshold of [PROFICIENT_BPM, EXPERT_BPM]) {
		if (hi < threshold && threshold - hi <= THRESHOLD_REACH_BPM) {
			hi = threshold;
			break;
		}
	}
	return { lo, hi };
}

/** A visible slice of one tempo band within the panel's y-range. */
export interface BpmBandSlice {
	phase: LickPhase;
	from: number;
	to: number;
}

/**
 * The tempo bands intersected with the visible range, in ascending order.
 * Bands entirely off-panel are dropped, and a range starting exactly on a
 * threshold yields no zero-height sliver below it.
 */
export function bpmBandSlices(lo: number, hi: number): BpmBandSlice[] {
	if (hi <= lo) return [];
	const slices: BpmBandSlice[] = [];
	TEMPO_PHASES.forEach(({ phase, from }, i) => {
		const to = TEMPO_PHASES[i + 1]?.from ?? Infinity;
		const clippedFrom = Math.max(from, lo);
		const clippedTo = Math.min(to, hi);
		if (clippedTo > clippedFrom) slices.push({ phase, from: clippedFrom, to: clippedTo });
	});
	return slices;
}
