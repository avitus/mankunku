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
 * Timing: beat offsets are laid out on a straight grid, then placed by
 * backing-timing.ts — swing at the beat→tick conversion, plus per-role
 * ensemble offsets (bass/ride on top, comp behind) and triangular jitter
 * from dedicated `<role>-time` streams. Jitter layers over swing, never
 * replaces it; musical draws and timing never share a stream.
 */

import type { HarmonicSegment, ChordQuality } from '$lib/types/music';
import { fractionToFloat } from '$lib/music/intervals';
import { swingForTempo } from '$lib/music/swing';
import {
	SWING_TIMING,
	createTimingStreams,
	placeEventTicks,
	type TimingProfile,
	type TimingRole,
	type TimingStreams
} from './backing-timing';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { createRng, seedFrom, type SeededRng } from './generation-rng';
import {
	pitchClassToNumber,
	shellVoicing,
	drop2Voicing,
	rootlessVoicingA,
	rootlessVoicingB,
	quartalVoicing,
	guideToneVoicing,
	voiceLead,
	type VoicingFn
} from './voicings';
import { planCompFigures, hitsForPlannedBar, headFigureFor } from './backing-comp-figures';
import type { StyleDefinition, GenerationContext, DrumVoice, DrumHitSpec } from './backing-styles';
import { generateBassLine as generateBassLine2 } from './backing-bass';

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
	/** Effective swing ratio (see `resolveBackingSwing`). */
	swing: number;
	sectionMap?: SectionMapEntry[];
	/** Per-role microtiming profiles (style.timing); SWING_TIMING when absent. */
	timing?: Record<TimingRole, TimingProfile>;
}

/**
 * Effective swing for the backing: the session value when the user swings
 * the melody (the band must share the soloist's grid), else the style's
 * model — 'tempo' follows the Friberg–Sundström curve (`swingForTempo`),
 * 'fixed' uses the style default. Scoring is untouched: it shares only the
 * melody's options.swing, and `swingForTempo` is banned from scorer
 * modules by a unit test.
 */
export function resolveBackingSwing(
	userSwing: number,
	style: StyleDefinition,
	tempo: number
): number {
	if (userSwing > 0.5) return userSwing;
	return style.swingModel === 'tempo' ? swingForTempo(tempo) : style.defaultSwing;
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
// Placement lives in backing-timing.ts: swung grid + per-role ensemble
// offset + triangular jitter from dedicated `<role>-time` streams, so
// musical draws and timing never share a stream.

function timingTableOf(params: BackingGenerationParams): Record<TimingRole, TimingProfile> {
	return params.timing ?? SWING_TIMING;
}

function place(
	absBeat: number,
	role: TimingRole,
	params: BackingGenerationParams,
	streams: TimingStreams,
	beatsPerBar: number
): string {
	const ticks = placeEventTicks(
		absBeat,
		params.swing,
		params.ppq,
		params.tempo,
		timingTableOf(params)[role],
		streams.for(role, Math.floor(absBeat / beatsPerBar))
	);
	return `${ticks}i`;
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
// Lives in backing-bass.ts (phrase-aware contour planner). Re-exported
// here so existing consumers/tests keep one import surface.
export { chordToneIntervalsForBass, generateBassLine } from './backing-bass';

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
	const { phraseId, tempo, swing } = params;
	const segments = toSegmentInfos(harmony);
	const beatDuration = 60 / tempo;
	const events: CompEvent[] = [];
	const onsetsByBar = new Map<number, number[]>();
	const streams = createTimingStreams(phraseId, tempo);

	// Voicing selection per chord, then voice-lead the whole sequence.
	// Quartal shapes join the rotation only for the qualities they suit
	// (they return [] for altered/diminished colors, which would silence
	// the hit rather than falling through).
	const chords = harmony.map((seg) => ({ root: seg.chord.root, quality: seg.chord.quality }));
	const fns: VoicingFn[] = chords.map((c, i) => {
		const rng = createRng(seedFrom(phraseId, tempo, 'voicing', i));
		if (!hasSeventhSlot(c.quality)) {
			return rng.weighted<VoicingFn>([
				{ value: shellVoicing, weight: 2 },
				{ value: drop2Voicing, weight: 1 }
			]);
		}
		const options: Array<{ value: VoicingFn; weight: number }> = [
			{ value: rootlessVoicingA, weight: 4 },
			{ value: rootlessVoicingB, weight: 3 },
			{ value: shellVoicing, weight: 2 },
			{ value: drop2Voicing, weight: 1 }
		];
		if (quartalVoicing(c.root, c.quality).length > 0) {
			options.push({ value: quartalVoicing, weight: 1 });
		}
		return rng.weighted<VoicingFn>(options);
	});
	const voicings = voiceLead(chords, fns, COMP_REGISTER);

	// Figure planning (swing, 4/4 only — the vocabulary is written for four
	// beats; other meters use the style's own fallback): one pass over the
	// phrase with anti-repetition memory; each bar's plan resolves to
	// concrete hits here so the style's pattern function only realizes
	// velocity/articulation.
	const compPlan =
		style.compPlanning && beatsPerBar === 4
			? planCompFigures(barInfos, beatsPerBar, phraseId, tempo)
			: null;

	const harmonyEnd = segments.reduce((max, s) => Math.max(max, s.startBeats + s.totalBeats), 0);
	const totalBars = barInfos.length;

	for (let bar = 0; bar < totalBars; bar++) {
		const rng = createRng(seedFrom(phraseId, tempo, 'comp', bar));
		const planned = compPlan?.[bar];
		const headFigure = compPlan ? headFigureFor(compPlan, bar) : undefined;
		const ctx: GenerationContext = {
			barIndex: bar,
			beatsPerBar,
			swing,
			rng,
			...barInfos[bar],
			plannedComp:
				planned && compPlan
					? {
							hits: hitsForPlannedBar(planned, compPlan, bar, barInfos[bar], beatsPerBar),
							tags: headFigure?.tags ?? [],
							guideTones: planned.guideTones
						}
					: undefined
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
			// Guide-tone bars thin the voicing to the 3rd+7th — the "leave
			// space" color — regardless of the chord's led shape.
			const chord = chords[segIdx];
			const voicing = ctx.plannedComp?.guideTones
				? guideToneVoicing(chord.root, chord.quality, COMP_REGISTER)
				: voicings[segIdx];
			if (!voicing || voicing.length === 0) continue;

			events.push({
				time: place(absBeat, 'comp', params, streams, beatsPerBar),
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
	const { phraseId, tempo, swing } = params;
	const events: DrumEvent[] = [];
	const streams = createTimingStreams(phraseId, tempo);

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
				time: place(absBeat, hit.drum, params, streams, beatsPerBar),
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

	const timedParams: BackingGenerationParams = { ...params, timing: params.timing ?? style.timing };
	const { events: compEvents, onsetsByBar } = generateComping(harmony, beatsPerBar, style, timedParams, barInfos);
	const { events: bassEvents } = generateBassLine2(harmony, beatsPerBar, timedParams, barInfos);
	const drumEvents = generateDrums(beatsPerBar, style, timedParams, barInfos, onsetsByBar);

	return { bassEvents, compEvents, drumEvents };
}
