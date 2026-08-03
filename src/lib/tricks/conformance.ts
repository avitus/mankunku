/**
 * Formula-conformance scoring for tricks (melodic devices).
 *
 * A played attempt is aligned to a trick's expected slots with the same DTW
 * skeleton as `scoring/alignment.ts` (3-way DP, SKIP_COST 2.0, diagonal
 * preferred on cost ties), but the exact-pitch cost is replaced by a
 * conformance cost: how well the played pitch CLASS satisfies the slot's
 * formula role. Octaves never matter — a trick is a shape of pitch classes.
 *
 * Tier semantics, tested per played note against a slot (best → worst):
 *   exact         pc ∈ slot.exactPcs   — the formula pitch itself
 *   in-pattern    pc ∈ slot.patternPcs — right device, wrong member
 *                                        (e.g. the mirrored approach note)
 *   in-scale      pc ∈ context scale   — diatonic but off-formula
 *   out-of-scale  anything else        — chromatic miss
 *   missed        slot aligned to no played note
 *
 * Credit table (patternScore = mean credit over ALL slots, missed = 0):
 *   exact 1.0 | in-pattern 0.7 | in-scale 0.4 | out-of-scale 0.1 | missed 0.0
 *
 * DTW match cost = tier cost (exact 0.0 | in-pattern 0.3 | in-scale 0.6 |
 * out-of-scale 1.0) + the rhythm term |Δonset|/beatSec capped at 1.0 — the
 * same rhythm term as alignment.ts, so pitch and rhythm contribute equally.
 *
 * Latency correction replicates scorer.ts exactly: align on raw onsets, take
 * the median (detected − expected) over matched pairs, subtract it from the
 * detected onsets for per-slot timing. The DTW is NOT re-run on corrected
 * onsets.
 */

import type { DetectedNote } from '$lib/types/audio';
import type { PitchClass } from '$lib/types/music';
import type {
	ConformanceResult,
	SlotConformanceResult,
	SlotConformanceTier,
	TrickContext,
	TrickSlotSpec
} from '$lib/types/tricks';
import { PITCH_CLASSES } from '$lib/types/music';
import { fractionToFloat, midiToPitchClass } from '$lib/music/intervals';
import { applySwingToBeats } from '$lib/music/swing';
import { scaleDegreeOf } from '$lib/music/scale-degree';
import { realizeScale } from '$lib/music/keys';
import { getScale } from '$lib/music/scales';
import { chordTones } from '$lib/music/chords';

/** Cost for a completely missed slot or extra played note (matches alignment.ts). */
const SKIP_COST = 2.0;

/** DTW pitch-term cost per tier — replaces alignment.ts's exact-pitch distance. */
const TIER_COST: Record<Exclude<SlotConformanceTier, 'missed'>, number> = {
	exact: 0.0,
	'in-pattern': 0.3,
	'in-scale': 0.6,
	'out-of-scale': 1.0
};

/** Partial credit per tier; patternScore is the mean over all slots. */
const TIER_CREDIT: Record<SlotConformanceTier, number> = {
	exact: 1.0,
	'in-pattern': 0.7,
	'in-scale': 0.4,
	'out-of-scale': 0.1,
	missed: 0.0
};

/** Scale degree label of a played MIDI note relative to the chord root. */
export function playedDegreeLabel(midi: number, chordRoot: PitchClass): string {
	return scaleDegreeOf(PITCH_CLASSES[midiToPitchClass(midi)], chordRoot).label;
}

/**
 * Pitch classes counted as "in-scale" for the context: the context scale
 * rooted at the chord root, or — when the scaleId is unknown — the chord
 * tones of the context chord, so an unrecognized scale degrades gracefully
 * rather than treating every diatonic note as a chromatic miss.
 */
function conformanceScaleSet(context: TrickContext): Set<number> {
	const scale = getScale(context.scaleId);
	if (scale) return new Set(realizeScale(context.chordRoot, scale.intervals));
	const rootMidi = PITCH_CLASSES.indexOf(context.chordRoot) + 60;
	return new Set(chordTones(rootMidi, context.chordQuality).map(midiToPitchClass));
}

/** Conformance tier of a played pitch class against one slot. */
function tierFor(
	playedPc: number,
	slot: TrickSlotSpec,
	scaleSet: Set<number>
): Exclude<SlotConformanceTier, 'missed'> {
	if (slot.exactPcs.includes(playedPc)) return 'exact';
	if (slot.patternPcs?.includes(playedPc)) return 'in-pattern';
	if (scaleSet.has(playedPc)) return 'in-scale';
	return 'out-of-scale';
}

/**
 * Expected slot onset in seconds: beats = fraction of a whole note × 4, with
 * the same off-beat-8th swing shift playback and scorer.ts use (shared
 * applySwingToBeats math), so a perfectly swung performance scores perfectly.
 */
function slotOnsetSeconds(slot: TrickSlotSpec, tempo: number, swing: number): number {
	const beats = fractionToFloat(slot.offset) * 4;
	return applySwingToBeats(beats, swing) * (60 / tempo);
}

/** Median of an array of numbers (cloned from scorer.ts, which keeps it private). */
function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One matched (slot, played) pair from the DTW backtrack. */
interface SlotAlignmentPair {
	slotIndex: number | null;
	playedIndex: number | null;
}

/**
 * DTW alignment of played notes to expected slots — the alignment.ts
 * skeleton with the conformance match cost. Slots are always pitched, so
 * there is no rest filtering.
 */
function alignSlots(
	slots: TrickSlotSpec[],
	played: DetectedNote[],
	context: TrickContext,
	scaleSet: Set<number>
): SlotAlignmentPair[] {
	const swing = context.swing ?? 0.5;
	const beatDuration = 60 / context.tempo;

	if (slots.length === 0) {
		return played.map((_, j) => ({ slotIndex: null, playedIndex: j }));
	}
	if (played.length === 0) {
		return slots.map((_, i) => ({ slotIndex: i, playedIndex: null }));
	}

	const matchCost = (i: number, j: number): number => {
		const tier = tierFor(midiToPitchClass(played[j].midi), slots[i], scaleSet);
		const expOnset = slotOnsetSeconds(slots[i], context.tempo, swing);
		const rhythm = Math.min(1.0, Math.abs(expOnset - played[j].onsetTime) / beatDuration);
		return TIER_COST[tier] + rhythm;
	};

	const N = slots.length;
	const M = played.length;

	// dp[i][j] = min cost to align slots[0..i-1] with played[0..j-1]
	const dp: number[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(0));
	for (let i = 1; i <= N; i++) dp[i][0] = dp[i - 1][0] + SKIP_COST;
	for (let j = 1; j <= M; j++) dp[0][j] = dp[0][j - 1] + SKIP_COST;

	for (let i = 1; i <= N; i++) {
		for (let j = 1; j <= M; j++) {
			dp[i][j] = Math.min(
				dp[i - 1][j - 1] + matchCost(i - 1, j - 1), // match
				dp[i - 1][j] + SKIP_COST, // skip slot (missed)
				dp[i][j - 1] + SKIP_COST // skip played (extra)
			);
		}
	}

	// Backtrack; diagonal checked first so ties prefer matching.
	const pairs: SlotAlignmentPair[] = [];
	let i = N;
	let j = M;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + matchCost(i - 1, j - 1)) {
			pairs.push({ slotIndex: i - 1, playedIndex: j - 1 });
			i--;
			j--;
		} else if (i > 0 && dp[i][j] === dp[i - 1][j] + SKIP_COST) {
			pairs.push({ slotIndex: i - 1, playedIndex: null });
			i--;
		} else {
			pairs.push({ slotIndex: null, playedIndex: j - 1 });
			j--;
		}
	}
	pairs.reverse();
	return pairs;
}

/**
 * Judge a played attempt against a trick's expected slots.
 *
 * Returns per-slot tier/credit results (in slot order), the mean-credit
 * patternScore, the count of played notes aligned to no slot, and the
 * latency correction that was subtracted before per-slot timing.
 */
export function scoreConformanceAgainstSpec(
	played: DetectedNote[],
	slots: TrickSlotSpec[],
	context: TrickContext
): ConformanceResult {
	const swing = context.swing ?? 0.5;
	const scaleSet = conformanceScaleSet(context);
	const pairs = alignSlots(slots, played, context, scaleSet);

	// Median matched-pair offset absorbs constant human/detection latency;
	// applied to detected onsets only — the alignment itself is not re-run.
	const offsets: number[] = [];
	for (const pair of pairs) {
		if (pair.slotIndex !== null && pair.playedIndex !== null) {
			const expOnset = slotOnsetSeconds(slots[pair.slotIndex], context.tempo, swing);
			offsets.push(played[pair.playedIndex].onsetTime - expOnset);
		}
	}
	const latencyCorrection = median(offsets);

	const playedIndexBySlot = new Map<number, number>();
	let extraCount = 0;
	for (const pair of pairs) {
		if (pair.slotIndex !== null && pair.playedIndex !== null) {
			playedIndexBySlot.set(pair.slotIndex, pair.playedIndex);
		} else if (pair.slotIndex === null) {
			extraCount++;
		}
	}

	const slotResults: SlotConformanceResult[] = slots.map((slot, i) => {
		const playedIndex = playedIndexBySlot.get(i);
		if (playedIndex === undefined) {
			return {
				slotIndex: i,
				role: slot.role,
				playedDegree: null,
				playedMidi: null,
				tier: 'missed' as const,
				credit: TIER_CREDIT.missed,
				onsetErrorMs: null
			};
		}
		const det = played[playedIndex];
		const tier = tierFor(midiToPitchClass(det.midi), slot, scaleSet);
		const expOnset = slotOnsetSeconds(slot, context.tempo, swing);
		return {
			slotIndex: i,
			role: slot.role,
			playedDegree: playedDegreeLabel(det.midi, context.chordRoot),
			playedMidi: det.midi,
			tier,
			credit: TIER_CREDIT[tier],
			onsetErrorMs: (det.onsetTime - latencyCorrection - expOnset) * 1000
		};
	});

	const patternScore =
		slots.length > 0
			? slotResults.reduce((sum, r) => sum + r.credit, 0) / slots.length
			: 0;

	return {
		slots: slotResults,
		patternScore,
		extraCount,
		latencyCorrectionMs: latencyCorrection * 1000
	};
}
