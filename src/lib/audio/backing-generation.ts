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
 * Seed-stream registry (role key x index -> consumer). Streams are
 * isolated: a draw added to one can never reshuffle another. Intensity
 * (backing-intensity.ts) is RNG-free and only reshapes weights at these
 * sites, so it is invisible to the registry.
 *
 *   bass-arc     | 4-bar group | register contour
 *   bass-feel    | chorusIndex | two/four feel
 *   bass-feel-escape | barIndex | walk-escape from a two-feel bar
 *   bass-target  | segment     | downbeat note choice
 *   bass-appr    | segment     | approach device
 *   bass         | segment     | interior fill, spice, velocity
 *                | barIndex    | (bossa pattern engine: pickups, drops, approach)
 *   clave        | 0           | bossa clave phase (one draw per phrase)
 *   voicing      | chord index | comp voicing choice
 *   comp-figure  | barIndex    | figure planning (weights only)
 *   comp         | barIndex    | comp realization
 *   drums        | barIndex    | ride mode, feather, snare, coupling
 *   drum-fill    | barIndex    | fills, setups, crash
 *   <role>-time  | barIndex    | timing jitter (backing-timing.ts)
 *
 * Timing: beat offsets are laid out on a straight grid, then placed by
 * backing-timing.ts — swing at the beat→tick conversion, plus per-role
 * ensemble offsets (bass/ride on top, comp behind) and triangular jitter
 * from dedicated `<role>-time` streams. Jitter layers over swing, never
 * replaces it; musical draws and timing never share a stream.
 */

import type { HarmonicSegment, ChordQuality } from '$lib/types/music';
import { fractionToFloat } from '$lib/music/intervals';
import { swingForTempo, STRAIGHT_SWING } from '$lib/music/swing';
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
import { barIntensity, lerp } from './backing-intensity';
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
import type { StyleDefinition, GenerationContext, DrumVoice } from './backing-styles';
import { generateBassLine as generateBassLine2, generateBossaBass } from './backing-bass';

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
 * Effective swing for the backing.
 *
 * The style owns the grid. A 'fixed' style (straight, bossa nova, ballad)
 * declares a genre whose eighth-note placement is not a matter of taste —
 * a bossa is straight — so its `defaultSwing` wins outright. Only the
 * 'tempo' style (swing) defers to the user's knob, falling back to the
 * Friberg–Sundström curve (`swingForTempo`) when that knob sits straight.
 *
 * This used to be inverted: any `userSwing > STRAIGHT_SWING` overrode the
 * style, and because the knob's first step off its 0.5 minimum is 0.55,
 * every non-default knob position silently swung Straight and Bossa Nova.
 * The old rule existed to keep the band on the soloist's grid; that
 * invariant is preserved by `resolveMelodySwing`, which moves the melody
 * onto the style's grid instead of dragging the band onto the melody's.
 *
 * `swingForTempo` stays banned from playback, scoring, and tricks modules
 * by a unit test — hence the melody-side resolver lives in backing-styles.ts
 * and never references it.
 */
export function resolveBackingSwing(
	userSwing: number,
	style: StyleDefinition,
	tempo: number
): number {
	if (style.swingModel === 'fixed') return style.defaultSwing;
	return userSwing > STRAIGHT_SWING ? userSwing : swingForTempo(tempo);
}

// ── Bar contexts ─────────────────────────────────────────────

export interface BarInfo {
	sectionIndex?: number;
	chorusIndex?: number;
	/** True on the first bar of a section (always true on bar 0 of a mapped phrase). */
	isSectionFirstBar: boolean;
	isSectionFinalBar: boolean;
	/** True on the first bar of a chorus pass (bar 0 of a mapped phrase included). */
	isChorusFirstBar?: boolean;
	/** True on the last bar of a chorus when another chorus follows (never the phrase's final bar). */
	isChorusFinalBar?: boolean;
	isFinalBar: boolean;
	/** Ensemble intensity for this bar (backing-intensity.ts), in [0.2, 0.9]. */
	intensity: number;
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
			infos.push({
				isSectionFirstBar: false,
				isSectionFinalBar: false,
				isFinalBar: b === totalBars - 1,
				intensity: barIntensity({ isSectionFinalBar: false, barIndex: b, totalBars })
			});
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
		const isSectionFinalBar = b === nextOffset - 1;
		infos.push({
			sectionIndex: k,
			chorusIndex: chorusOf[k],
			isSectionFirstBar: b === sectionMap[k].barOffset,
			isSectionFinalBar,
			isChorusFirstBar:
				b === sectionMap[k].barOffset && (k === 0 || chorusOf[k] > chorusOf[k - 1]),
			isChorusFinalBar:
				isSectionFinalBar && k + 1 < sectionMap.length && chorusOf[k + 1] > chorusOf[k],
			isFinalBar: b === totalBars - 1,
			intensity: barIntensity({
				chorusIndex: chorusOf[k],
				isSectionFinalBar,
				barIndex: b,
				totalBars
			})
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
	// Each chord reads the intensity of the bar it starts in: sparse shells
	// early, quartal color as the band digs in, and the register center
	// drifting up — voiceLead's closeness-to-previous keeps the drift smooth.
	const chordIntensity = segments.map(
		(seg) =>
			barInfos[Math.min(Math.floor(seg.startBeats / beatsPerBar), barInfos.length - 1)]
				?.intensity ?? 0.5
	);
	const bias = style.voicingBias ?? {};
	const fns: VoicingFn[] = chords.map((c, i) => {
		const rng = createRng(seedFrom(phraseId, tempo, 'voicing', i));
		if (!hasSeventhSlot(c.quality)) {
			return rng.weighted<VoicingFn>([
				{ value: shellVoicing, weight: 2 * (bias.shell ?? 1) },
				{ value: drop2Voicing, weight: 1 * (bias.drop2 ?? 1) }
			]);
		}
		const options: Array<{ value: VoicingFn; weight: number }> = [
			{ value: rootlessVoicingA, weight: 4 * (bias.rootlessA ?? 1) },
			{ value: rootlessVoicingB, weight: 3 * (bias.rootlessB ?? 1) },
			{ value: shellVoicing, weight: 2 * lerp(1.5, 0.6, chordIntensity[i]) * (bias.shell ?? 1) },
			{ value: drop2Voicing, weight: 1 * (bias.drop2 ?? 1) }
		];
		if (quartalVoicing(c.root, c.quality).length > 0) {
			options.push({
				value: quartalVoicing,
				weight: lerp(0.5, 1.5, chordIntensity[i]) * (bias.quartal ?? 1)
			});
		}
		return rng.weighted<VoicingFn>(options);
	});
	const voicings = voiceLead(
		chords,
		fns,
		chordIntensity.map((n) => Math.round(lerp(58, 66, n)))
	);

	// Figure planning (compPlanning styles — swing and straight — 4/4 only:
	// the vocabulary is written for four beats; other meters use the
	// style's own fallback): one pass over the
	// phrase with anti-repetition memory; each bar's plan resolves to
	// concrete hits here so the style's pattern function only realizes
	// velocity/articulation.
	const compPlan =
		style.compPlanning && beatsPerBar === 4
			? planCompFigures(barInfos, beatsPerBar, phraseId, tempo, style.compFigureBias)
			: null;

	const harmonyEnd = segments.reduce((max, s) => Math.max(max, s.startBeats + s.totalBeats), 0);
	const totalBars = barInfos.length;

	const clavePhase = clavePhaseFor(phraseId, tempo);
	for (let bar = 0; bar < totalBars; bar++) {
		const rng = createRng(seedFrom(phraseId, tempo, 'comp', bar));
		const planned = compPlan?.[bar];
		const headFigure = compPlan ? headFigureFor(compPlan, bar) : undefined;
		const ctx: GenerationContext = {
			barIndex: bar,
			beatsPerBar,
			swing,
			rng,
			clavePhase,
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

/**
 * One phrase-level draw from the dedicated `clave` stream: the bossa clave
 * side must be constant across the whole phrase AND across the comp and
 * drum generators (a rim and a guitar-hand on different sides is the one
 * unforgivable bossa mistake — caught by a property test when the phase
 * initially lived only in the drum ctx). Deterministic in (phraseId,
 * tempo), so every caller computes the identical phase.
 */
export function clavePhaseFor(phraseId: string, tempo: number): '32' | '23' {
	return createRng(seedFrom(phraseId, tempo, 'clave', 0)).chance(0.5) ? '32' : '23';
}

// ── Drums ────────────────────────────────────────────────────

/**
 * Generate drum events from the style's per-bar pattern. Receives the comp
 * and bass onsets so the pattern can talk to the band (snare echoes, kick
 * catches and pickup doubles), and hands each bar a dedicated
 * `('drum-fill', bar)` stream so form punctuation never reshuffles the
 * timekeeping draws.
 */
export function generateDrums(
	beatsPerBar: number,
	style: StyleDefinition,
	params: BackingGenerationParams,
	barInfos: BarInfo[],
	compOnsetsByBar: Map<number, number[]>,
	bassOnsetsByBar?: Map<number, number[]>
): DrumEvent[] {
	const { phraseId, tempo, swing } = params;
	const events: DrumEvent[] = [];
	const streams = createTimingStreams(phraseId, tempo);
	const clavePhase = clavePhaseFor(phraseId, tempo);
	const byAbsBeat = new Map<string, { drum: DrumVoice; velocity: number; absBeat: number }>();

	for (let bar = 0; bar < barInfos.length; bar++) {
		const rng = createRng(seedFrom(phraseId, tempo, 'drums', bar));
		const ctx: GenerationContext = {
			barIndex: bar,
			beatsPerBar,
			swing,
			rng,
			compOnsets: compOnsetsByBar.get(bar),
			bassOnsets: bassOnsetsByBar?.get(bar),
			fillRng: createRng(seedFrom(phraseId, tempo, 'drum-fill', bar)),
			clavePhase,
			...barInfos[bar]
		};
		// The feathered-kick, comp-accent, and section-final setup branches
		// can collide on one offset — and the anticipated push (a negative
		// offset emitted by the NEXT bar) lands inside the previous bar,
		// where that bar's own kick may sit. Two sampler starts at the
		// identical tick read as a doubled hit, so the ledger spans bars:
		// keep the louder one per (voice, absBeat). Map insertion order is
		// emission order, which fixes each hit's jitter-draw index.
		for (const hit of style.drumPattern(ctx)) {
			const absBeat = bar * beatsPerBar + hit.beatOffset;
			const key = `${hit.drum}:${absBeat}`;
			const prev = byAbsBeat.get(key);
			if (!prev || hit.velocity > prev.velocity) {
				byAbsBeat.set(key, { drum: hit.drum, velocity: hit.velocity, absBeat });
			}
		}
	}

	// A crash is the right hand leaving the ride — wherever one lands, a
	// tick-coincident ride or hat stroke would need a third limb. Downbeat
	// crashes already displace their ride at the pattern level
	// (suppressDownbeatRide), but the anticipated push lands inside the
	// PREVIOUS bar, on top of its ride skip (and sometimes a setup hat) at
	// the same swung eighth — only this cross-bar sweep can see that. Kick
	// and snare stay: crash-with-shot is idiomatic, crash-with-ride is
	// impossible.
	for (const { drum, absBeat } of [...byAbsBeat.values()]) {
		if (drum !== 'crash') continue;
		byAbsBeat.delete(`ride:${absBeat}`);
		byAbsBeat.delete(`hihat:${absBeat}`);
	}

	for (const { drum, velocity, absBeat } of byAbsBeat.values()) {
		events.push({
			time: place(absBeat, drum, params, streams, beatsPerBar),
			drum,
			velocity,
			absBeat
		});
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
	let barInfos = buildBarInfos(totalBars, params.sectionMap);
	// A style may cap the ensemble arc (ballad: never dig in past 0.6);
	// applied to the whole timeline so every generator reads the same
	// ceiling.
	if (style.intensityCap !== undefined) {
		const cap = style.intensityCap;
		barInfos = barInfos.map((info) => ({ ...info, intensity: Math.min(info.intensity, cap) }));
	}

	const timedParams: BackingGenerationParams = { ...params, timing: params.timing ?? style.timing };
	const { events: compEvents, onsetsByBar } = generateComping(harmony, beatsPerBar, style, timedParams, barInfos);
	// Bass engine dispatch: the bossa root–fifth pattern is a 4/4 statement;
	// 'two' pins the walking planner to permanent two-feel (ballad); other
	// meters (and every 'auto' style) take the plain walking planner.
	const { events: bassEvents, onsetsByBar: bassOnsetsByBar } =
		style.bass === 'pattern' && beatsPerBar === 4
			? generateBossaBass(harmony, beatsPerBar, timedParams, barInfos)
			: generateBassLine2(
					harmony,
					beatsPerBar,
					timedParams,
					barInfos,
					style.bass === 'two' ? 'two' : undefined
				);
	const drumEvents = generateDrums(beatsPerBar, style, timedParams, barInfos, onsetsByBar, bassOnsetsByBar);

	return { bassEvents, compEvents, drumEvents };
}

// ── Memoized entry point ─────────────────────────────────────

const GENERATION_CACHE_LIMIT = 4;
/** key → serialized result. Values are stored as JSON and re-parsed per
 *  hit so every caller gets fresh objects — no shared-mutation hazard. */
const generationCache = new Map<string, string>();

/**
 * `generateBacking` behind a small LRU — provably safe because generation
 * is deterministic in (harmony, style, params): same key, same events.
 * Serves the live scheduler, where lick-practice loops and tempo retries
 * regenerate the identical backing many times per session. The key
 * includes the full harmony content (styles are keyed by name — their
 * functions aren't serializable, and name identifies the vocabulary).
 */
export function generateBackingCached(
	harmony: HarmonicSegment[],
	style: StyleDefinition,
	params: BackingGenerationParams
): GeneratedBacking {
	const key = JSON.stringify([style.name, params, harmony]);
	const hit = generationCache.get(key);
	if (hit !== undefined) {
		// Refresh recency (Map preserves insertion order).
		generationCache.delete(key);
		generationCache.set(key, hit);
		return JSON.parse(hit) as GeneratedBacking;
	}
	const generated = generateBacking(harmony, style, params);
	const serialized = JSON.stringify(generated);
	generationCache.set(key, serialized);
	if (generationCache.size > GENERATION_CACHE_LIMIT) {
		generationCache.delete(generationCache.keys().next().value as string);
	}
	return generated;
}
