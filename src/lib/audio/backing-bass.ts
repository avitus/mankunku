/**
 * Walking-bass line planner: phrase-aware contour instead of per-segment
 * cell-walking.
 *
 * Modeled on the contour-based generator literature and bass pedagogy —
 * a pro line has three properties the old per-segment walk lacked:
 *   1. It goes somewhere: register follows a multi-bar arc (arch/rise/
 *      fall/drop per 4-bar group), not a fixed ±6-semitone cell.
 *   2. Chord changes are announced: every segment's final beats approach
 *      the NEXT downbeat by a weighted device vocabulary (chromatic from
 *      either side, scalar, dominant, enclosure, double-chromatic,
 *      octave-drop), and downbeats land on root/3rd/5th with the root
 *      strongly favored.
 *   3. Early choruses can play "in 2" (root + 5th half notes) and open up
 *      to 4 later — with walk escapes at group ends so the two-feel
 *      breathes.
 *
 * Interior beats fill scale-aware: strong beats favor chord tones, weak
 * beats scale steps; non-scale non-chromatic candidates are dropped, A-B-A
 * oscillation is damped, direction has inertia.
 *
 * Seed streams (see the registry in backing-generation.ts): `bass-feel`
 * per chorus, `bass-arc` per 4-bar group, `bass-target`/`bass-appr` per
 * segment, `bass` per segment for realization — all independent, so a
 * probability change in one pass cannot reshuffle another.
 */

import type { HarmonicSegment, ChordQuality } from '$lib/types/music';
import { fractionToFloat } from '$lib/music/intervals';
import { getScale } from '$lib/music/scales';
import { realizeScale } from '$lib/music/keys';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { createRng, seedFrom, type SeededRng } from './generation-rng';
import { lerp } from './backing-intensity';
import { pitchClassToNumber } from './voicings';
import { createTimingStreams, placeEventTicks, SWING_TIMING } from './backing-timing';
import type { BassEvent, BackingGenerationParams, BarInfo } from './backing-generation';

/**
 * Chord-tone intervals the bass outlines, read from CHORD_DEFINITIONS so
 * every quality gets its true tones: min7b5 → b3/b5/b7, dim7 → b3/b5/bb7,
 * aug7 → 3/#5/b7, sus4 → 4/5/b7. The natural 5th is preferred when the
 * definition carries both (7#11, 7b13) — colour tones belong to the comp,
 * not the walking line. 6th chords walk their 6th in the 7th slot; plain
 * triads have none.
 */
export function chordToneIntervalsForBass(quality: ChordQuality): {
	third: number;
	fifth: number;
	seventh: number | null;
} {
	const def = CHORD_DEFINITIONS[quality];
	const iv = def?.intervals ?? [0, 4, 7];
	const has = (n: number) => iv.includes(n);
	const third = has(4) ? 4 : has(3) ? 3 : has(5) ? 5 : has(2) ? 2 : 4;
	const fifth = has(7) ? 7 : (iv.find((i) => i >= 6 && i <= 8) ?? 7);
	const seventh = iv.find((i) => i >= 9 && i <= 11) ?? null;
	return { third, fifth, seventh };
}

const BASS_LOW = 28; // E1
const BASS_HIGH = 55; // G3
const ARC_CENTER_LOW = 33;
const ARC_CENTER_HIGH = 48;
const ARC_CENTER_BASE = 40; // E2

export interface BassLineResult {
	events: BassEvent[];
	/** Beat offsets (within-bar) of every audible bass onset, per bar. */
	onsetsByBar: Map<number, number[]>;
}

// ── Segment analysis ─────────────────────────────────────────

interface BassSegment {
	startBeats: number;
	totalBeats: number;
	rootPc: number;
	quality: ChordQuality;
	scalePcs: number[];
	chordPcs: number[];
}

/** Scale step-interval fallbacks by chord family, when scaleId is unknown. */
const FALLBACK_STEPS: Record<string, number[]> = {
	// step intervals (sum 12): Mixolydian, Dorian, Ionian, Locrian, whole-half dim
	mixolydian: [2, 2, 1, 2, 2, 1, 2],
	dorian: [2, 1, 2, 2, 2, 1, 2],
	ionian: [2, 2, 1, 2, 2, 2, 1],
	locrian: [1, 2, 2, 1, 2, 2, 2],
	dim: [2, 1, 2, 1, 2, 1, 2, 1]
};

function fallbackStepsFor(quality: ChordQuality): number[] {
	if (quality === 'min7b5') return FALLBACK_STEPS.locrian;
	if (quality === 'dim7' || quality === 'dim') return FALLBACK_STEPS.dim;
	if (quality.startsWith('min')) return FALLBACK_STEPS.dorian;
	if (quality.startsWith('maj')) return FALLBACK_STEPS.ionian;
	return FALLBACK_STEPS.mixolydian;
}

function toBassSegments(harmony: HarmonicSegment[]): BassSegment[] {
	return harmony.map((seg) => {
		const rootPc = pitchClassToNumber(seg.chord.root);
		const scale = getScale(seg.scaleId);
		const scalePcs = scale
			? realizeScale(seg.chord.root, scale.intervals)
			: realizeScale(seg.chord.root, fallbackStepsFor(seg.chord.quality));
		const tones = chordToneIntervalsForBass(seg.chord.quality);
		const chordPcs = [0, tones.third, tones.fifth, ...(tones.seventh !== null ? [tones.seventh] : [])].map(
			(i) => (rootPc + i) % 12
		);
		return {
			startBeats: fractionToFloat(seg.startOffset) * 4,
			totalBeats: Math.round(fractionToFloat(seg.duration) * 4),
			rootPc,
			quality: seg.chord.quality,
			scalePcs,
			chordPcs
		};
	});
}

// ── Plan passes ──────────────────────────────────────────────

/** Nearest MIDI with pitch class `pc` to `target`, clamped to the bass band. */
function nearestPc(pc: number, target: number): number {
	// Round FIRST: arc centers are fractional, and a fractional pitch class
	// poisons the whole diff computation into float MIDI.
	const t = Math.round(target);
	const targetPc = ((t % 12) + 12) % 12;
	let diff = (((pc - targetPc) % 12) + 12) % 12;
	if (diff > 6) diff -= 12;
	let midi = t + diff;
	while (midi < BASS_LOW) midi += 12;
	while (midi > BASS_HIGH) midi -= 12;
	return midi;
}

type ArcShape = 'arch' | 'rise' | 'fall' | 'flat' | 'drop';

const ARC_SHAPES: Array<{ value: ArcShape; weight: number }> = [
	{ value: 'arch', weight: 3 },
	{ value: 'rise', weight: 2 },
	{ value: 'fall', weight: 2 },
	{ value: 'flat', weight: 2 },
	{ value: 'drop', weight: 1 }
];

function shapeValue(shape: ArcShape, x: number): number {
	switch (shape) {
		case 'arch':
			return Math.sin(Math.PI * x) - 0.5;
		case 'rise':
			return x - 0.5;
		case 'fall':
			return 0.5 - x;
		case 'flat':
			return 0;
		case 'drop':
			return -0.5;
	}
}

/** Register-arc center for every bar: one (shape, amplitude) per 4-bar group. */
function planArc(
	totalBars: number,
	barInfos: BarInfo[],
	phraseId: string,
	tempo: number
): number[] {
	const centers: number[] = new Array(totalBars);
	for (let group = 0; group * 4 < totalBars; group++) {
		const rng = createRng(seedFrom(phraseId, tempo, 'bass-arc', group));
		const shape = rng.weighted(ARC_SHAPES.map((s) => ({ value: s.value, weight: s.weight })));
		const amp = rng.int(3, 7);
		for (let b = 0; b < 4 && group * 4 + b < totalBars; b++) {
			const bar = group * 4 + b;
			let center = ARC_CENTER_BASE + amp * shapeValue(shape, b / 3);
			// Top of a later chorus: sometimes dig in low — the classic reset.
			const info = barInfos[bar];
			const isChorusFirst =
				(info.chorusIndex ?? 0) >= 1 && (bar === 0 || barInfos[bar - 1].chorusIndex !== info.chorusIndex);
			if (isChorusFirst && rng.chance(0.25)) center = ARC_CENTER_LOW;
			centers[bar] = Math.max(ARC_CENTER_LOW, Math.min(ARC_CENTER_HIGH, center));
		}
	}
	return centers;
}

/** Two-feel vs walking-four, planned per chorus and latched to 'four'. */
function planFeel(barInfos: BarInfo[], phraseId: string, tempo: number): Array<'two' | 'four'> {
	const feels: Array<'two' | 'four'> = new Array(barInfos.length).fill('four');
	if (!barInfos.some((b) => b.chorusIndex !== undefined)) return feels;
	const chorusFeel = new Map<number, 'two' | 'four'>();
	for (let bar = 0; bar < barInfos.length; bar++) {
		const chorus = barInfos[bar].chorusIndex ?? 0;
		if (!chorusFeel.has(chorus)) {
			const rng = createRng(seedFrom(phraseId, tempo, 'bass-feel', chorus));
			// Only the first chorus may sit in 2; once the band opens up to 4
			// it stays there (latch).
			chorusFeel.set(chorus, chorus === 0 && rng.chance(0.65) ? 'two' : 'four');
		}
		feels[bar] = chorusFeel.get(chorus)!;
	}
	return feels;
}

type ApproachDevice =
	| 'chromatic-below'
	| 'chromatic-above'
	| 'scalar'
	| 'dominant'
	| 'enclosure'
	| 'double-chromatic'
	| 'octave-drop';

const APPROACH_WEIGHTS: Array<{ value: ApproachDevice; weight: number; beats: 1 | 2 }> = [
	{ value: 'chromatic-below', weight: 28, beats: 1 },
	{ value: 'chromatic-above', weight: 16, beats: 1 },
	{ value: 'scalar', weight: 16, beats: 1 },
	{ value: 'dominant', weight: 14, beats: 1 },
	{ value: 'enclosure', weight: 12, beats: 2 },
	{ value: 'double-chromatic', weight: 8, beats: 2 },
	{ value: 'octave-drop', weight: 6, beats: 2 }
];

interface SegmentPlan {
	/** Downbeat degree as semitone offset from the root (0, third, fifth). */
	downbeatOffset: number;
	device: ApproachDevice;
	deviceBeats: 1 | 2;
}

function planSegments(
	segments: BassSegment[],
	barInfos: BarInfo[],
	beatsPerBar: number,
	phraseId: string,
	tempo: number
): SegmentPlan[] {
	return segments.map((seg, segIdx) => {
		const targetRng = createRng(seedFrom(phraseId, tempo, 'bass-target', segIdx));
		const apprRng = createRng(seedFrom(phraseId, tempo, 'bass-appr', segIdx));
		const tones = chordToneIntervalsForBass(seg.quality);

		const bar = Math.floor(seg.startBeats / beatsPerBar);
		const info = barInfos[Math.min(bar, barInfos.length - 1)];
		const isChorusFirst =
			bar === 0 || (info.chorusIndex !== undefined && barInfos[bar - 1]?.chorusIndex !== info.chorusIndex);
		const downbeatOffset =
			segIdx === 0 || isChorusFirst
				? 0
				: targetRng.weighted([
						{ value: 0, weight: 72 },
						{ value: tones.third, weight: 14 },
						{ value: tones.fifth, weight: 14 }
					]);

		let pick = apprRng.weighted(
			APPROACH_WEIGHTS.map((a) => ({ value: a, weight: a.weight }))
		);
		if (pick.beats === 2 && seg.totalBeats < 4) {
			pick = APPROACH_WEIGHTS[0]; // short segments: plain chromatic from below
		}
		return { downbeatOffset, device: pick.value, deviceBeats: pick.beats };
	});
}

// ── Realization ──────────────────────────────────────────────

/** Approach-device pitches into `target`, most-distant first. */
function devicePitches(
	device: ApproachDevice,
	target: number,
	scalePcs: number[],
	rng: SeededRng
): number[] {
	switch (device) {
		case 'chromatic-below':
			return [target - 1];
		case 'chromatic-above':
			return [target + 1];
		case 'scalar': {
			// Nearest scale tone a step above or below the target.
			const dir = rng.chance(0.6) ? -1 : 1;
			for (const dist of [2, 1]) {
				const cand = target + dir * dist;
				if (scalePcs.includes(((cand % 12) + 12) % 12)) return [cand];
			}
			return [target - 2];
		}
		case 'dominant':
			return [nearestPc((target + 7) % 12, target)];
		case 'enclosure': {
			const upperFirst = rng.chance(0.5);
			return upperFirst ? [target + 1, target - 1] : [target - 1, target + 1];
		}
		case 'double-chromatic':
			return [target - 2, target - 1];
		case 'octave-drop': {
			const up = target + 12 <= BASS_HIGH ? target + 12 : target - 12;
			return [up, target - 1];
		}
	}
}

/**
 * Generate the bass line. Drop-in replacement for the old
 * `generateWalkingBass`, plus per-bar onsets for the drummer's ears.
 *
 * `feelOverride: 'two'` (the ballad engine, `StyleDefinition.bass ===
 * 'two'`) pins EVERY bar to the two-feel — no chorus latch, no 4-bar
 * walk escapes, no section-final walk: a ballad states half notes all
 * night. The `bass-feel`/`bass-feel-escape` streams go unconsumed under
 * the override (they're dedicated, so nothing else reshuffles).
 */
export function generateBassLine(
	harmony: HarmonicSegment[],
	beatsPerBar: number,
	params: BackingGenerationParams,
	barInfos: BarInfo[],
	feelOverride?: 'two'
): BassLineResult {
	const { phraseId, tempo, ppq, swing } = params;
	const timing = params.timing ?? SWING_TIMING;
	const streams = createTimingStreams(phraseId, tempo);
	const segments = toBassSegments(harmony);
	const plans = planSegments(segments, barInfos, beatsPerBar, phraseId, tempo);
	/** The pitch class each segment's downbeat will actually sound. */
	const downbeatPc = (idx: number): number =>
		(segments[idx].rootPc + plans[idx].downbeatOffset) % 12;
	const centers = planArc(barInfos.length, barInfos, phraseId, tempo);
	const feels = feelOverride ? null : planFeel(barInfos, phraseId, tempo);
	const beatDuration = 60 / tempo;

	const events: BassEvent[] = [];
	const onsetsByBar = new Map<number, number[]>();

	const centerAt = (absBeat: number): number =>
		centers[Math.min(Math.floor(absBeat / beatsPerBar), centers.length - 1)] ?? ARC_CENTER_BASE;
	const infoAt = (absBeat: number): BarInfo =>
		barInfos[Math.min(Math.floor(absBeat / beatsPerBar), barInfos.length - 1)];
	const feelAt = (absBeat: number): 'two' | 'four' => {
		if (feelOverride) return feelOverride;
		const fs = feels as Array<'two' | 'four'>;
		const bar = Math.min(Math.floor(absBeat / beatsPerBar), fs.length - 1);
		const info = infoAt(absBeat);
		// A two-feel chorus still walks where the form needs motion: the last
		// bar of each 4-bar group sometimes, section-final bars always.
		if (fs[bar] === 'two') {
			if (info.isSectionFinalBar) return 'four';
			if (bar % 4 === 3) {
				const rng = createRng(seedFrom(phraseId, tempo, 'bass-feel-escape', bar));
				if (rng.chance(0.3)) return 'four';
			}
			return 'two';
		}
		return 'four';
	};

	const push = (absBeat: number, midi: number, duration: number, velocity: number): void => {
		const bar = Math.floor(absBeat / beatsPerBar);
		events.push({
			time: `${placeEventTicks(absBeat, swing, ppq, tempo, timing.bass, streams.for('bass', bar))}i`,
			midi: Math.max(BASS_LOW, Math.min(BASS_HIGH, midi)),
			duration,
			velocity,
			absBeat
		});
		const list = onsetsByBar.get(bar) ?? [];
		list.push(absBeat - bar * beatsPerBar);
		onsetsByBar.set(bar, list);
	};

	let prevMidi: number | null = null;
	let prevPrevMidi: number | null = null;
	let prevDir = 0;

	for (let segIdx = 0; segIdx < segments.length; segIdx++) {
		const seg = segments[segIdx];
		const plan = plans[segIdx];
		const rng = createRng(seedFrom(phraseId, tempo, 'bass', segIdx));
		const hasNext = segIdx + 1 < segments.length;
		const next = hasNext ? segments[segIdx + 1] : seg;
		const L = seg.totalBeats - 1;

		// Downbeat: planned degree, octave placed by the register arc —
		// contour drives register, not proximity to wherever we happened
		// to be. A > 7-semitone leap from the previous note gets nudged an
		// octave toward it when that stays near the arc.
		const center = centerAt(seg.startBeats);
		let downbeat = nearestPc((seg.rootPc + plan.downbeatOffset) % 12, center);
		// A 3rd/5th-colored downbeat that lands exactly on the note just
		// played reads as a stutter, not color — fall back to the root (the
		// root is never the previous segment's approach target's repeat in a
		// progression that actually moves).
		if (prevMidi !== null && downbeat === prevMidi && plan.downbeatOffset !== 0) {
			downbeat = nearestPc(seg.rootPc, center);
		}
		if (prevMidi !== null && Math.abs(downbeat - prevMidi) > 7) {
			const nudged = downbeat + (prevMidi > downbeat ? 12 : -12);
			// The nudge tames leaps but must not fold ONTO the previous note —
			// trading an octave displacement (clean, idiomatic) for a stutter.
			if (
				nudged !== prevMidi &&
				Math.abs(nudged - center) <= 9 &&
				nudged >= BASS_LOW &&
				nudged <= BASS_HIGH
			) {
				downbeat = nudged;
			} else if (Math.abs(downbeat - prevMidi) > 12) {
				// The arc pulls hard, but never more than an octave at once.
				while (downbeat - prevMidi > 12 && downbeat - 12 >= BASS_LOW) downbeat -= 12;
				while (prevMidi - downbeat > 12 && downbeat + 12 <= BASS_HIGH) downbeat += 12;
			}
		}

		const notes: Array<number | null> = new Array(seg.totalBeats).fill(null);
		notes[0] = downbeat;

		// Approach into the pitch the next downbeat will ACTUALLY sound —
		// a bassist approaches the note they are about to play, so when the
		// planner colors a downbeat with the 3rd or 5th, the device leads
		// there, not to a root that never arrives.
		const nextTarget: number = hasNext
			? nearestPc(downbeatPc(segIdx + 1), centerAt(next.startBeats))
			: nearestPc((seg.rootPc + (L % 2 === 1 ? chordToneIntervalsForBass(seg.quality).fifth : 0)) % 12, downbeat);
		let deviceStart = seg.totalBeats; // exclusive of device beats by default
		if (hasNext && L >= 1 && feelAt(seg.startBeats + L) === 'four') {
			const pitches = devicePitches(plan.device, nextTarget, seg.scalePcs, rng);
			const beats = Math.min(plan.deviceBeats, L) as 1 | 2;
			deviceStart = seg.totalBeats - beats;
			// The handoff constraint in the interior walk (last beat lands
			// within 4 of the device pitch) keeps the entry singable, so the
			// device pitches stay exactly as designed — folding them by
			// octaves here octave-displaced approaches into lurches.
			for (let i = 0; i < beats; i++) {
				let pitch = pitches[pitches.length - beats + i];
				// A single-beat device directly after the downbeat must not
				// restate it (dominant-of-the-approached-pitch can collide,
				// e.g. A7 root → Dm7 fifth → dominant-of-D = A three times).
				if (beats === 1 && deviceStart === 1 && pitch === notes[0]) {
					pitch = nextTarget - 1;
				}
				notes[deviceStart + i] = pitch;
			}
		} else if (!hasNext && L >= 1 && feelAt(seg.startBeats + L) === 'four') {
			// Final segment settles on the last beat — walking feel only. A
			// two-feel ending already rests after its half-note pair; a settle
			// note here doubled the beat-3 fifth back-to-back (the stutter the
			// candidate weights guard against everywhere else).
			notes[L] = nextTarget;
		}

		// Spice draws (fixed order for determinism), BEFORE the walk so the
		// line can respond to them: an octave skip applied after the walk was
		// chosen stomped handoffs and orphaned its neighbors. Ornament
		// probabilities scale with the segment's bar intensity — the line
		// stays plain early and talks more as the band digs in.
		const spice = lerp(0.6, 1.4, infoAt(seg.startBeats).intensity);
		const ghostBeat =
			seg.totalBeats >= 3 && rng.chance(0.1 * spice) ? rng.int(1, Math.max(1, L - 1)) : -1;
		// The pickup only sounds in a walking-four bar — resolve that ONCE so
		// the final note's duration and the emission agree (a two-feel bar was
		// shortening its last note for a pickup that never sounded).
		const pickupActive =
			hasNext && rng.chance(0.12 * spice) && feelAt(seg.startBeats + L) === 'four';
		const octaveSkipBeat =
			deviceStart >= 3 && rng.chance(0.06 * spice) ? rng.int(1, deviceStart - 2) : -1;

		// Interior walk toward the device start (or the settle note).
		const goal = notes[deviceStart] ?? notes[L] ?? nextTarget;
		for (let beat = 1; beat < deviceStart; beat++) {
			const absBeat = seg.startBeats + beat;
			if (feelAt(absBeat) === 'two') continue; // two-feel: interior beats rest
			const prev = notes[beat - 1] ?? prevMidi ?? downbeat;
			// Octave skip as a WALKED ornament: leap the octave of the note
			// being left; the following beats chase the goal back down.
			if (beat === octaveSkipBeat) {
				const jumped = prev + (prev + 12 <= BASS_HIGH ? 12 : -12);
				notes[beat] = jumped;
				continue;
			}
			const beatInBar = Math.round(absBeat) % beatsPerBar;
			const strong = beatInBar === 0 || beatInBar === 2;

			const candidates = new Set<number>();
			for (const pc of seg.chordPcs) candidates.add(nearestPc(pc, prev));
			for (const d of [-2, -1, 1, 2]) candidates.add(prev + d);

			const isHandoff = beat === deviceStart - 1;
			const gap = goal - prev;
			const mustChase = Math.abs(gap) > 5; // stranded: every step must close in
			const center = centerAt(absBeat);
			const weighted: Array<{ value: number; weight: number }> = [];
			for (const cand of candidates) {
				if (cand < BASS_LOW || cand > BASS_HIGH) continue;
				if (cand === prev) continue;
				const candPc = ((cand % 12) + 12) % 12;
				const inScale = seg.scalePcs.includes(candPc);
				const isChromaticNeighbor = Math.abs(cand - prev) === 1;
				if (!inScale && !isChromaticNeighbor) continue;
				const leap = Math.abs(cand - prev);
				if (leap > 7) continue;
				if (mustChase && Math.sign(cand - prev) !== Math.sign(gap)) continue;
				// The beat before the approach device must land close enough
				// that the device's entry is singable, not a lurch.
				if (isHandoff && Math.abs(cand - goal) > 5) continue;
				let weight = 1;
				// Steps are the fabric of a walking line; chord-tone skips are
				// seasoning, not the default.
				if (leap <= 2) weight += 3;
				if (Math.sign(goal - cand) === Math.sign(gap) && Math.abs(goal - cand) < Math.abs(gap)) {
					weight += mustChase ? 4 : 2;
				}
				if (strong && seg.chordPcs.includes(candPc)) weight += 1;
				if (!strong && inScale) weight += 1;
				if (prevDir !== 0 && Math.sign(cand - prev) === prevDir) weight += 1;
				// Soft containment: don't drift further from the arc center
				// once already an augmented 4th outside it.
				if (Math.abs(prev - center) > 6 && Math.abs(cand - center) > Math.abs(prev - center)) {
					weight *= 0.5;
				}
				const twoBack = beat >= 2 ? notes[beat - 2] : prevPrevMidi;
				if (twoBack !== null && cand === twoBack) weight *= 0.4;
				weighted.push({ value: cand, weight });
			}
			notes[beat] =
				weighted.length > 0
					? rng.weighted(weighted)
					: isHandoff
						? nearestPc(seg.rootPc, goal)
						: nearestPc(seg.rootPc, prev);
		}

		// Emit.
		for (let beat = 0; beat < seg.totalBeats; beat++) {
			const absBeat = seg.startBeats + beat;
			const beatInBar = Math.round(absBeat) % beatsPerBar;
			const feel = feelAt(absBeat);
			let midi = notes[beat];
			if (midi === null) {
				if (feel === 'two' && beatInBar === 0) {
					// Interior downbeat of a held chord: a two-feel bassist
					// restates the anchor every bar — the original downbeat
					// pitch, with the fifth on alternating bars for motion.
					// Deterministic (no draw), so the stream's later choices
					// are untouched; this fixes silent bar-2 downbeats in BOTH
					// the ballad override and swing's chorus-0 two-feel.
					const tones = chordToneIntervalsForBass(seg.quality);
					const barOfSeg = Math.floor(beat / beatsPerBar);
					midi =
						barOfSeg % 2 === 1
							? nearestPc((seg.rootPc + tones.fifth) % 12, notes[0]!)
							: notes[0]!;
				} else if (feel === 'two' && beatInBar === 2) {
					// Two-feel beat 3: mostly the 5th, sometimes 3rd/octave, or an
					// early approach when the chord changes at the next barline.
					const tones = chordToneIntervalsForBass(seg.quality);
					const changeNext = hasNext && beat === seg.totalBeats - 2;
					midi =
						changeNext && rng.chance(0.15)
							? nextTarget - 1
							: rng.weighted(
									[
										{ value: nearestPc((seg.rootPc + tones.fifth) % 12, notes[0]!), weight: 55 },
										{ value: nearestPc((seg.rootPc + tones.third) % 12, notes[0]!), weight: 20 },
										{ value: notes[0]! + 12 <= BASS_HIGH ? notes[0]! + 12 : notes[0]! - 12, weight: 10 }
									// Beat 3 restates motion, not the downbeat pitch — filter
									// the SEGMENT downbeat (a fifth-colored one made "the
									// fifth" a repeat) AND the note just played (an interior
									// bar's restated fifth downbeat would machine-gun with a
									// fifth fill). Three distinct values, two filters: the
									// list can never empty.
									].filter((o) => o.value !== notes[0] && o.value !== prevMidi)
								);
				} else {
					continue; // two-feel rest beats
				}
			}

			// Two-feel halves sustain: the downbeat always, and — under the
			// ballad override — the beat-3 half too (swing's chorus-0 two-feel
			// keeps its detached beat 3; that articulation is the style).
			const isTwoFeelHalf =
				feel === 'two' && (beatInBar === 0 || (feelOverride !== undefined && beatInBar === 2));
			const velocity =
				rng.int(76, 88) + (beatInBar === 0 ? 4 : 0) + (beatInBar === 2 ? 2 : 0);
			push(
				absBeat,
				midi,
				beatDuration * (isTwoFeelHalf ? 1.7 : beat === L && pickupActive ? 0.45 : 0.85),
				velocity
			);

			if (beat === ghostBeat && feel === 'four') {
				push(absBeat + 0.5, midi, beatDuration * 0.2, rng.int(34, 44));
			}

			prevPrevMidi = prevMidi;
			if (prevMidi !== null) prevDir = Math.sign(midi - prevMidi);
			prevMidi = midi;
		}

		// Swung-eighth pickup into the next downbeat.
		if (pickupActive) {
			const absBeat = seg.startBeats + seg.totalBeats - 0.5;
			push(
				absBeat,
				rng.pick([prevMidi ?? downbeat, nextTarget - 1, nextTarget + 1]),
				beatDuration * 0.3,
				rng.int(52, 60)
			);
		}

		// Section-final triplet fill on the last beat — a small "here we go"
		// that the swung grid never touches (triplet offsets are swing-immune
		// by construction). Mutually exclusive with the pickup: two ornaments
		// stacked on one beat is clutter, not conversation. Gated off under
		// the permanent two-feel override — a ballad's sections end still.
		const lastInfo = infoAt(seg.startBeats + L);
		if (
			feelOverride === undefined &&
			!pickupActive &&
			hasNext &&
			lastInfo.isSectionFinalBar &&
			!lastInfo.isFinalBar &&
			Math.round(seg.startBeats + L) % beatsPerBar === beatsPerBar - 1 &&
			rng.chance(0.22 * lerp(0.6, 1.4, lastInfo.intensity))
		) {
			const base = notes[L] ?? prevMidi ?? downbeat;
			push(seg.startBeats + L + 1 / 3, base + (rng.chance(0.5) ? 1 : -1), beatDuration * 0.18, 58);
			push(seg.startBeats + L + 2 / 3, nextTarget - 1, beatDuration * 0.18, 66);
		}
	}

	return { events, onsetsByBar };
}

// ── Bossa pattern bass ───────────────────────────────────────

/**
 * Bossa nova bass: the surdo-derived root–fifth ostinato, not a walking
 * line. The pattern lives on the BAR grid — the same grid the clave and
 * kick are locked to — with a per-beat chord lookup, so split bars
 * (|Dm7 G7|) state the new root at the change point instead of floating
 * the ostinato off the barline: root of the sounding chord on 1; on 3
 * the mid-bar chord's root when the harmony moves there (always stated),
 * else the quality-aware fifth; soft eighth pickups on the and-of-2
 * (leading beat 3 — a chromatic approach when the chord changes there)
 * and the and-of-4 (leading the next bar — an approach when the barline
 * brings a new chord). Variation drops thin the pickups and the beat-3
 * fifth so the pattern breathes without losing the anchor. Register sits
 * flat around E2 (no arc — bossa sits, it doesn't climb); the fifth
 * takes the surdo drop below the root, which the register policy
 * guarantees stays in band. Events go through the same per-role timing
 * placement as the walking line, drawing from the `bass` role keyed by
 * bar index (the walking planner keys it by segment; the two generators
 * never run on the same phrase).
 *
 * 4/4 only by contract — `generateBacking` falls back to the walking
 * planner for other meters.
 */
export function generateBossaBass(
	harmony: HarmonicSegment[],
	beatsPerBar: number,
	params: BackingGenerationParams,
	barInfos: BarInfo[]
): BassLineResult {
	const { phraseId, tempo, ppq, swing } = params;
	const timing = params.timing ?? SWING_TIMING;
	const streams = createTimingStreams(phraseId, tempo);
	const segments = toBassSegments(harmony);
	// Empty harmony → empty line (chordAt would index segments[0]).
	if (segments.length === 0) return { events: [], onsetsByBar: new Map() };
	const beatDuration = 60 / tempo;
	const totalBars = barInfos.length;

	const events: BassEvent[] = [];
	const onsetsByBar = new Map<number, number[]>();
	const push = (absBeat: number, midi: number, duration: number, velocity: number): void => {
		const bar = Math.floor(absBeat / beatsPerBar);
		events.push({
			time: `${placeEventTicks(absBeat, swing, ppq, tempo, timing.bass, streams.for('bass', bar))}i`,
			midi: Math.max(BASS_LOW, Math.min(BASS_HIGH, midi)),
			duration,
			velocity,
			absBeat
		});
		const list = onsetsByBar.get(bar) ?? [];
		list.push(absBeat - bar * beatsPerBar);
		onsetsByBar.set(bar, list);
	};

	/** The chord sounding at a beat: last segment starting at or before it
	 *  (segments are sorted and contiguous; beats past the end clamp). */
	const chordAt = (absBeat: number): BassSegment => {
		let current = segments[0];
		for (const seg of segments) {
			if (seg.startBeats <= absBeat + 1e-6) current = seg;
			else break;
		}
		return current;
	};
	const rootFor = (seg: BassSegment): number => nearestPc(seg.rootPc, ARC_CENTER_BASE);
	/** The surdo drop: the quality-aware fifth below the root (the register
	 *  policy pins roots ≥ 34, so the drop always stays in band). */
	const fifthFor = (rootMidi: number, seg: BassSegment): number =>
		rootMidi + chordToneIntervalsForBass(seg.quality).fifth - 12;

	for (let bar = 0; bar < totalBars; bar++) {
		const barStart = bar * beatsPerBar;
		const rng = createRng(seedFrom(phraseId, tempo, 'bass', bar));
		const isPhraseFinalBar = bar === totalBars - 1;
		const segAt0 = chordAt(barStart);
		const segAt2 = chordAt(barStart + 2);
		// Content comparison, not identity: a repeated chord written as two
		// segments (|F F|) is a held chord, not a change.
		const changesMidBar = segAt2.rootPc !== segAt0.rootPc || segAt2.quality !== segAt0.quality;
		const root0 = rootFor(segAt0);
		const beat3Midi = changesMidBar ? rootFor(segAt2) : fifthFor(root0, segAt0);

		// Beat 1: the sounding chord's root, always.
		push(barStart, root0, beatDuration * 1.4, rng.int(72, 80));

		if (isPhraseFinalBar) {
			// Settle: long root, no pickup out. A real mid-bar change still
			// sounds unconditionally — "always stated" holds on every bar —
			// only the held-chord fifth restatement is optional here.
			if (changesMidBar || rng.chance(0.5)) {
				push(barStart + 2, beat3Midi, beatDuration * 1.6, rng.int(62, 70));
			}
			continue;
		}

		// And-of-2 pickup leading beat 3: a chromatic approach when the
		// chord changes there, else the fifth (the feminine half of the lilt).
		if (rng.chance(0.6)) {
			const pickup = changesMidBar
				? beat3Midi + (rng.chance(0.67) ? -1 : 1)
				: beat3Midi;
			push(barStart + 1.5, pickup, beatDuration * 0.35, rng.int(56, 63));
		}

		// Beat 3: a mid-bar chord change is ALWAYS stated; a held chord's
		// fifth occasionally rests so the root rings (the variation drop).
		if (changesMidBar || rng.chance(0.9)) {
			push(barStart + 2, beat3Midi, beatDuration * 1.4, rng.int(68, 76));
		}

		// And-of-4 pickup into the next bar: an approach when the barline
		// brings a new chord, else the sounding root again.
		if (rng.chance(0.7)) {
			const nextSeg = chordAt(barStart + beatsPerBar);
			const soundingRoot = changesMidBar ? rootFor(segAt2) : root0;
			let pickup = soundingRoot;
			if (nextSeg.rootPc !== segAt2.rootPc) {
				const nextRootMidi = rootFor(nextSeg);
				pickup = rng.weighted([
					{ value: nextRootMidi - 1, weight: 2 }, // chromatic below
					{ value: nextRootMidi + 1, weight: 1 }, // chromatic above
					{ value: fifthFor(nextRootMidi, nextSeg), weight: 1 }
				]);
			}
			push(barStart + 3.5, pickup, beatDuration * 0.35, rng.int(58, 65));
		}
	}

	return { events, onsetsByBar };
}
