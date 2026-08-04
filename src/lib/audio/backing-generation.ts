/**
 * Pure backing-track event generation: walking bass, comping, and drums.
 *
 * Everything here is deterministic and Node-testable — no Tone.js, no
 * Web Audio. `backing-track.ts` turns these events into scheduled parts.
 * All randomness flows through seeded streams derived from the phrase id,
 * tempo and bar position, so the same phrase at the same tempo always
 * generates the same backing while different bars (and different passes
 * through a tune's form) vary.
 *
 * Timing: beat offsets are laid out on a straight grid, swung at the
 * beat→tick conversion via `applySwingToBeats` (off-beat eighths land
 * late), then given a few milliseconds of seeded jitter on top
 * (`humanizeTicks`) — jitter layers over swing, it never replaces it.
 */

import type { HarmonicSegment, ChordQuality } from '$lib/types/music';
import { fractionToFloat } from '$lib/music/intervals';
import { applySwingToBeats } from '$lib/music/swing';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { createRng, seedFrom, type SeededRng } from './generation-rng';
import {
	pitchClassToNumber,
	shellVoicing,
	drop2Voicing,
	rootlessVoicingA,
	rootlessVoicingB,
	voiceLead,
	type VoicingFn
} from './voicings';
import type { StyleDefinition, GenerationContext, DrumVoice, DrumHitSpec } from './backing-styles';

// ── Event shapes ─────────────────────────────────────────────

export interface BassEvent {
	/** Tick-based Transport time, e.g. "480i" (swing + jitter applied). */
	time: string;
	midi: number;
	/** Duration in seconds. */
	duration: number;
	/** MIDI velocity 0–127. */
	velocity: number;
	/** Pre-swing beat position on the phrase timeline (diagnostics/tests). */
	absBeat: number;
}

export interface CompEvent {
	time: string;
	notes: number[];
	duration: number;
	velocity: number;
	absBeat: number;
}

export interface DrumEvent {
	time: string;
	drum: DrumVoice;
	/** Normalized velocity 0–1 (converted to MIDI at trigger time). */
	velocity: number;
	absBeat: number;
}

export interface GeneratedBacking {
	bassEvents: BassEvent[];
	compEvents: CompEvent[];
	drumEvents: DrumEvent[];
}

export type SectionMapEntry = { sourceSection: number; barOffset: number };

export interface BackingGenerationParams {
	phraseId: string;
	tempo: number;
	ppq: number;
	beatsPerBar: number;
	/** Effective swing ratio (session swing when swung, else the style default). */
	swing: number;
	sectionMap?: SectionMapEntry[];
}

/**
 * Effective swing for the backing: the session value when the user swings
 * the melody, else the style's default — so the swing style's ride pattern
 * swings even while the melody setting sits straight. Scoring is untouched
 * (it shares only the melody's options.swing).
 */
export function resolveEffectiveSwing(userSwing: number, style: StyleDefinition): number {
	return userSwing > 0.5 ? userSwing : style.defaultSwing;
}

// ── Bar contexts ─────────────────────────────────────────────

export interface BarInfo {
	sectionIndex?: number;
	chorusIndex?: number;
	isSectionFinalBar: boolean;
	isFinalBar: boolean;
}

/**
 * Per-bar section/chorus positions from a tune's sectionMap. A new chorus
 * starts wherever the emitted sourceSection sequence restarts (does not
 * increase) — e.g. body, ending 1, body, ending 2. Bars past the last
 * entry (harmony tail extension) belong to the last section. Without a
 * sectionMap, bars are position-free: only the final bar is flagged.
 */
export function buildBarInfos(totalBars: number, sectionMap?: SectionMapEntry[]): BarInfo[] {
	const infos: BarInfo[] = [];
	if (!sectionMap || sectionMap.length === 0) {
		for (let b = 0; b < totalBars; b++) {
			infos.push({ isSectionFinalBar: false, isFinalBar: b === totalBars - 1 });
		}
		return infos;
	}

	const chorusOf: number[] = [];
	let chorus = 0;
	for (let k = 0; k < sectionMap.length; k++) {
		if (k > 0 && sectionMap[k].sourceSection <= sectionMap[k - 1].sourceSection) chorus++;
		chorusOf.push(chorus);
	}

	for (let b = 0; b < totalBars; b++) {
		let k = 0;
		for (let i = 0; i < sectionMap.length; i++) {
			if (sectionMap[i].barOffset <= b) k = i;
		}
		const nextOffset = k + 1 < sectionMap.length ? sectionMap[k + 1].barOffset : totalBars;
		infos.push({
			sectionIndex: k,
			chorusIndex: chorusOf[k],
			isSectionFinalBar: b === nextOffset - 1,
			isFinalBar: b === totalBars - 1
		});
	}
	return infos;
}

// ── Timing ───────────────────────────────────────────────────

/**
 * Subtle timing humanization for backing track (tighter than melody).
 * Seeded so replays are identical.
 */
function humanizeTicks(ticks: number, ppq: number, tempo: number, rng: SeededRng): number {
	const baseMs = 3;
	const tempoScale = 120 / tempo;
	const maxDeviationMs = baseMs * tempoScale;
	const msPerTick = (60 / tempo / ppq) * 1000;
	const maxDeviationTicks = Math.round(maxDeviationMs / msPerTick);
	const deviation = (rng.float() - 0.5) * 2 * maxDeviationTicks;
	return Math.max(0, Math.round(ticks + deviation));
}

/** Straight beat position → swung, humanized Transport ticks. */
function beatToTicks(absBeat: number, swing: number, ppq: number, tempo: number, rng: SeededRng): number {
	const swung = applySwingToBeats(absBeat, swing);
	return humanizeTicks(Math.round(swung * ppq), ppq, tempo, rng);
}

// ── Harmony helpers ──────────────────────────────────────────

interface SegmentInfo {
	startBeats: number;
	totalBeats: number;
	rootPc: number;
	quality: ChordQuality;
}

function toSegmentInfos(harmony: HarmonicSegment[]): SegmentInfo[] {
	return harmony.map((seg) => ({
		startBeats: fractionToFloat(seg.startOffset) * 4,
		totalBeats: Math.round(fractionToFloat(seg.duration) * 4),
		rootPc: pitchClassToNumber(seg.chord.root),
		quality: seg.chord.quality
	}));
}

/** Index of the segment sounding at the given beat, or -1. */
function segmentIndexAt(segments: SegmentInfo[], beat: number): number {
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i];
		if (beat >= s.startBeats && beat < s.startBeats + s.totalBeats) return i;
	}
	return -1;
}

// ── Walking bass ─────────────────────────────────────────────

const BASS_LOW = 28; // E1
const BASS_HIGH = 55; // G3
const BASS_CENTER = 40; // E2

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

/** Nearest MIDI with the given pitch class to `target`, kept in the bass band. */
function nearestBassPc(pc: number, target: number): number {
	const targetPc = ((target % 12) + 12) % 12;
	let diff = (((pc - targetPc) % 12) + 12) % 12;
	if (diff > 6) diff -= 12;
	let midi = target + diff;
	while (midi < BASS_LOW) midi += 12;
	while (midi > BASS_HIGH) midi -= 12;
	return midi;
}

/**
 * Like nearestBassPc but kept two semitones inside the band, so chromatic
 * and scale-step devices built around the result stay in range too.
 */
function nearestBassPcSoft(pc: number, target: number): number {
	let midi = nearestBassPc(pc, target);
	if (midi > BASS_HIGH - 2) midi -= 12;
	if (midi < BASS_LOW + 2) midi += 12;
	return midi;
}

/**
 * Generate a walking bass line: one quarter per beat, each bar planned as a
 * path from the current chord toward the next root. Beat 1 is the root most
 * of the time (occasionally 3rd or 5th), interior beats walk stepwise toward
 * the target, and the last beat of each segment approaches the next root by
 * a seeded choice of device — chromatic, dominant (5th above), scale step,
 * or a two-beat enclosure. Sparse swung-eighth pickups and ghosted dead
 * notes keep it human without turning it into a solo.
 */
export function generateWalkingBass(
	harmony: HarmonicSegment[],
	beatsPerBar: number,
	params: BackingGenerationParams
): BassEvent[] {
	const { phraseId, tempo, ppq, swing } = params;
	const segments = toSegmentInfos(harmony);
	const events: BassEvent[] = [];
	const beatDuration = 60 / tempo;

	let prevMidi: number | null = null;

	for (let segIdx = 0; segIdx < segments.length; segIdx++) {
		const seg = segments[segIdx];
		const rng = createRng(seedFrom(phraseId, tempo, 'bass', segIdx));
		const tones = chordToneIntervalsForBass(seg.quality);
		const hasNext = segIdx + 1 < segments.length;
		const nextRootPc = hasNext ? segments[segIdx + 1].rootPc : seg.rootPc;

		const notes: number[] = new Array(seg.totalBeats);
		const L = seg.totalBeats - 1;

		// Beat 1: the root most of the time; a 3rd or 5th for variety once
		// the line is underway.
		const rootHere = nearestBassPc(seg.rootPc, prevMidi ?? BASS_CENTER);
		if (segIdx === 0 || prevMidi === null || rng.chance(0.8)) {
			notes[0] = rootHere;
		} else {
			const alt = rng.chance(0.5) ? tones.third : tones.fifth;
			notes[0] = nearestBassPc((seg.rootPc + alt) % 12, prevMidi);
		}

		// Approach into the next root on the segment's final beat(s).
		const target = nearestBassPcSoft(nextRootPc, notes[0]);
		let enclosureStart = -1;
		if (L >= 1 && hasNext) {
			if (seg.totalBeats >= 4 && rng.chance(0.18)) {
				// Two-beat enclosure around the next root.
				enclosureStart = L - 1;
				const upperFirst = rng.chance(0.5);
				notes[L - 1] = target + (upperFirst ? 1 : -1);
				notes[L] = target + (upperFirst ? -1 : 1);
			} else {
				notes[L] = rng.weighted([
					{ value: target - 1, weight: 3 }, // chromatic from below
					{ value: target + 1, weight: 2 }, // chromatic from above
					{ value: nearestBassPc((nextRootPc + 7) % 12, target), weight: 2 }, // dominant
					{ value: target + (rng.chance(0.6) ? -2 : 2), weight: 2 } // scale step
				]);
			}
		} else if (L >= 1) {
			// Final segment: settle on a chord tone instead of approaching.
			notes[L] = nearestBassPc((seg.rootPc + (L % 2 === 1 ? tones.fifth : 0)) % 12, notes[0]);
		}

		// Interior beats: stepwise walk toward the approach target.
		const interiorEnd = enclosureStart >= 0 ? enclosureStart : L;
		for (let beat = 1; beat < interiorEnd; beat++) {
			const prev = notes[beat - 1];
			const chordPcs = [0, tones.third, tones.fifth, ...(tones.seventh !== null ? [tones.seventh] : [])]
				.map((i) => (seg.rootPc + i) % 12);
			const candidates = new Set<number>();
			for (const pc of chordPcs) candidates.add(nearestBassPc(pc, prev));
			candidates.add(prev + 1);
			candidates.add(prev - 1);
			candidates.add(prev + 2);
			candidates.add(prev - 2);

			const goal = enclosureStart >= 0 ? target : (notes[L] ?? target);
			const weighted: Array<{ value: number; weight: number }> = [];
			for (const cand of candidates) {
				if (cand < BASS_LOW || cand > BASS_HIGH) continue;
				if (cand === prev) continue; // no lazy repeats
				const leap = Math.abs(cand - prev);
				if (leap > 7) continue;
				let weight = 1;
				if (leap <= 2) weight += 2;
				if (Math.sign(goal - cand) === Math.sign(goal - prev) && Math.abs(goal - cand) < Math.abs(goal - prev)) {
					weight += 2; // progress toward the target
				}
				if (chordPcs.includes(((cand % 12) + 12) % 12)) weight += 1;
				weighted.push({ value: cand, weight });
			}
			notes[beat] = weighted.length > 0 ? rng.weighted(weighted) : nearestBassPc(seg.rootPc, prev);
		}

		// Emit the quarters.
		const ghostBeat = seg.totalBeats >= 3 && rng.chance(0.1) ? rng.int(1, Math.max(1, L - 1)) : -1;
		const pickup = hasNext && rng.chance(0.12);
		for (let beat = 0; beat < seg.totalBeats; beat++) {
			const absBeat = seg.startBeats + beat;
			const beatInBar = Math.round(absBeat) % beatsPerBar;
			const isLast = beat === L;
			events.push({
				time: `${beatToTicks(absBeat, swing, ppq, tempo, rng)}i`,
				midi: notes[beat],
				duration: beatDuration * (isLast && pickup ? 0.45 : 0.85),
				velocity: rng.int(76, 88) + (beatInBar === 0 ? 4 : 0),
				absBeat
			});
			// Ghosted "dead" repeat — felt more than heard.
			if (beat === ghostBeat) {
				events.push({
					time: `${beatToTicks(absBeat + 0.5, swing, ppq, tempo, rng)}i`,
					midi: notes[beat],
					duration: beatDuration * 0.2,
					velocity: rng.int(36, 44),
					absBeat: absBeat + 0.5
				});
			}
		}

		// Swung-eighth pickup into the next downbeat.
		if (pickup) {
			const absBeat = seg.startBeats + seg.totalBeats - 0.5;
			const nextTarget = nearestBassPcSoft(nextRootPc, notes[L]);
			events.push({
				time: `${beatToTicks(absBeat, swing, ppq, tempo, rng)}i`,
				midi: rng.pick([notes[L], nextTarget - 1, nextTarget + 1]),
				duration: beatDuration * 0.3,
				velocity: rng.int(52, 60),
				absBeat
			});
		}

		prevMidi = notes[L] ?? notes[0];
	}

	return events;
}

// ── Comping ──────────────────────────────────────────────────

const COMP_REGISTER = 62;

function hasSeventhSlot(quality: ChordQuality): boolean {
	const def = CHORD_DEFINITIONS[quality];
	return def ? def.intervals.some((i) => i >= 9 && i <= 11) : false;
}

/**
 * Generate comp events: a voicing type per chord (rootless A/B, shell, or
 * drop-2 — seeded, quality-aware), voice-led across the sequence, placed by
 * the style's per-bar figures. Off-beat (eighth) hits voice the chord
 * sounding on the NEXT beat, so a push across a chord change anticipates
 * the coming harmony the way a comper actually plays it.
 */
export function generateComping(
	harmony: HarmonicSegment[],
	beatsPerBar: number,
	style: StyleDefinition,
	params: BackingGenerationParams,
	barInfos: BarInfo[]
): { events: CompEvent[]; onsetsByBar: Map<number, number[]> } {
	const { phraseId, tempo, ppq, swing } = params;
	const segments = toSegmentInfos(harmony);
	const beatDuration = 60 / tempo;
	const events: CompEvent[] = [];
	const onsetsByBar = new Map<number, number[]>();

	// Voicing selection per chord, then voice-lead the whole sequence.
	const chords = harmony.map((seg) => ({ root: seg.chord.root, quality: seg.chord.quality }));
	const fns: VoicingFn[] = chords.map((c, i) => {
		const rng = createRng(seedFrom(phraseId, tempo, 'voicing', i));
		if (!hasSeventhSlot(c.quality)) {
			return rng.weighted<VoicingFn>([
				{ value: shellVoicing, weight: 2 },
				{ value: drop2Voicing, weight: 1 }
			]);
		}
		return rng.weighted<VoicingFn>([
			{ value: rootlessVoicingA, weight: 4 },
			{ value: rootlessVoicingB, weight: 3 },
			{ value: shellVoicing, weight: 2 },
			{ value: drop2Voicing, weight: 1 }
		]);
	});
	const voicings = voiceLead(chords, fns, COMP_REGISTER);

	const harmonyEnd = segments.reduce((max, s) => Math.max(max, s.startBeats + s.totalBeats), 0);
	const totalBars = barInfos.length;

	for (let bar = 0; bar < totalBars; bar++) {
		const rng = createRng(seedFrom(phraseId, tempo, 'comp', bar));
		const ctx: GenerationContext = {
			barIndex: bar,
			beatsPerBar,
			swing,
			rng,
			...barInfos[bar]
		};
		const hits = style.compPattern(ctx);
		onsetsByBar.set(bar, hits.map((h) => h.beatOffset));

		for (const hit of hits) {
			const absBeat = bar * beatsPerBar + hit.beatOffset;
			if (absBeat >= harmonyEnd) continue;
			// Eighth off-beats anticipate: voice the chord on the next beat.
			const lookup = hit.beatOffset % 1 !== 0 ? absBeat + 0.5 : absBeat;
			let segIdx = segmentIndexAt(segments, Math.min(lookup, harmonyEnd - 0.001));
			if (segIdx < 0) segIdx = segmentIndexAt(segments, absBeat);
			if (segIdx < 0) continue;
			const voicing = voicings[segIdx];
			if (!voicing || voicing.length === 0) continue;

			events.push({
				time: `${beatToTicks(absBeat, swing, ppq, tempo, rng)}i`,
				notes: voicing,
				duration: beatDuration * hit.durationBeats,
				velocity: hit.velocity,
				absBeat
			});
		}
	}

	return { events, onsetsByBar };
}

// ── Drums ────────────────────────────────────────────────────

/**
 * Generate drum events from the style's per-bar pattern. Receives the comp
 * onsets so the pattern can catch strong comp hits with kick accents.
 */
export function generateDrums(
	beatsPerBar: number,
	style: StyleDefinition,
	params: BackingGenerationParams,
	barInfos: BarInfo[],
	compOnsetsByBar: Map<number, number[]>
): DrumEvent[] {
	const { phraseId, tempo, ppq, swing } = params;
	const events: DrumEvent[] = [];

	for (let bar = 0; bar < barInfos.length; bar++) {
		const rng = createRng(seedFrom(phraseId, tempo, 'drums', bar));
		const ctx: GenerationContext = {
			barIndex: bar,
			beatsPerBar,
			swing,
			rng,
			compOnsets: compOnsetsByBar.get(bar),
			...barInfos[bar]
		};
		// The feathered-kick, comp-accent, and section-final setup branches
		// can collide on one offset; two sampler starts at the identical
		// tick read as a doubled hit. Keep the louder one per (voice, beat).
		const byOffset = new Map<string, DrumHitSpec>();
		for (const hit of style.drumPattern(ctx)) {
			const key = `${hit.drum}:${hit.beatOffset}`;
			const prev = byOffset.get(key);
			if (!prev || hit.velocity > prev.velocity) byOffset.set(key, hit);
		}
		for (const hit of byOffset.values()) {
			const absBeat = bar * beatsPerBar + hit.beatOffset;
			events.push({
				time: `${beatToTicks(absBeat, swing, ppq, tempo, rng)}i`,
				drum: hit.drum,
				velocity: hit.velocity,
				absBeat
			});
		}
	}

	return events;
}

// ── Entry point ──────────────────────────────────────────────

/**
 * Generate the full backing for a harmony timeline: comp first (drums read
 * its onsets for accents), then bass, then drums. `params.sectionMap`
 * (from `Phrase.sectionMap`) drives section/chorus awareness; without it
 * bars are counted flat.
 */
export function generateBacking(
	harmony: HarmonicSegment[],
	style: StyleDefinition,
	params: BackingGenerationParams
): GeneratedBacking {
	const { beatsPerBar } = params;
	const harmonyBeats = harmony.reduce(
		(max, seg) => Math.max(max, fractionToFloat(seg.startOffset) * 4 + fractionToFloat(seg.duration) * 4),
		0
	);
	const totalBars = Math.max(1, Math.ceil(harmonyBeats / beatsPerBar));
	const barInfos = buildBarInfos(totalBars, params.sectionMap);

	const { events: compEvents, onsetsByBar } = generateComping(harmony, beatsPerBar, style, params, barInfos);
	const bassEvents = generateWalkingBass(harmony, beatsPerBar, params);
	const drumEvents = generateDrums(beatsPerBar, style, params, barInfos, onsetsByBar);

	return { bassEvents, compEvents, drumEvents };
}
