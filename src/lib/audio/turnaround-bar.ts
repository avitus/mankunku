/**
 * One bar of rhythm-section turnaround (ii-V into a target key) as plain,
 * schedulable data — the glue between deep-practice cycles.
 *
 * Why not phrase harmony: the next cycle's `scheduleNextPhrase` runs a
 * deferred `disposeBackingParts()` that destroys not-yet-fired events in
 * the singleton backing Tone.Parts at exactly the moment the turnaround
 * should sound. And why not built into the super-phrase: the turnaround's
 * target key is the NEXT cycle's head key, which is decided by scores
 * earned during the current cycle — unknowable at super-phrase build time.
 * So the session page schedules these events as independent transport
 * callbacks whose handlers trigger instruments near-now (the proven
 * `playTransitionChords` pattern — see `playBackingHitsNow`).
 *
 * Pure and seeded: realization goes through `generateBacking`, so the same
 * inputs always produce the same bar (the seed varies with the target key,
 * so different keys get different figures).
 */

import type { PitchClass, HarmonicSegment } from '$lib/types/music';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import type { BackingStyle } from '$lib/types/instruments';
import { PROGRESSION_TEMPLATES, transposeProgression } from '$lib/data/progressions';
import { BACKING_STYLES, type DrumVoice } from './backing-styles';
import { generateBacking, resolveBackingSwing } from './backing-generation';

/** One instrument trigger, mirroring the backing Parts' callback payloads. */
export type BackingHit =
	| { kind: 'bass'; midi: number; velocity: number; duration: number }
	| { kind: 'comp'; notes: number[]; velocity: number; duration: number }
	| { kind: 'drum'; drum: DrumVoice; velocity: number };

export interface TurnaroundEvent {
	/** Ticks from the start of the turnaround bar. */
	tickOffset: number;
	hit: BackingHit;
}

/**
 * The turnaround's harmony: half a bar of ii, half a bar of V, resolving
 * into `targetKey`. Chord qualities and scales follow the house templates —
 * a minor-tonic progression gets the minor cadence (half-diminished ii,
 * altered V), everything else the major one. Offsets/durations are in
 * whole-note fractions, so one bar of `beatsPerBar` beats spans [beatsPerBar, 4].
 */
export function turnaroundHarmony(
	progressionType: ChordProgressionType,
	targetKey: PitchClass,
	beatsPerBar: number
): HarmonicSegment[] {
	// Templates are written in C; the tonic segment is the one rooted on C
	// (same detection as getTransitionCadenceChords).
	const tonic = PROGRESSION_TEMPLATES[progressionType]?.harmony.find(
		(seg) => seg.chord.root === 'C'
	);
	const minor = tonic?.chord.quality.startsWith('min') ?? false;

	const half: [number, number] = [beatsPerBar, 8];
	const cRooted: HarmonicSegment[] = minor
		? [
				{
					chord: { root: 'D', quality: 'min7b5' },
					scaleId: 'harmonic-minor.locrian-sharp6',
					startOffset: [0, 1],
					duration: half
				},
				{
					chord: { root: 'G', quality: '7alt' },
					scaleId: 'melodic-minor.altered',
					startOffset: half,
					duration: half
				}
			]
		: [
				{
					chord: { root: 'D', quality: 'min7' },
					scaleId: 'major.dorian',
					startOffset: [0, 1],
					duration: half
				},
				{
					chord: { root: 'G', quality: '7' },
					scaleId: 'major.mixolydian',
					startOffset: half,
					duration: half
				}
			];

	return transposeProgression(cRooted, targetKey);
}

/**
 * Realize the turnaround bar as instrument hits with tick offsets relative
 * to the bar start. Events are clamped into the bar: a negative-jitter
 * downbeat plays at 0, and anything the swing/jitter pushed past the bar
 * line is dropped so it can't collide with the next cycle's downbeat.
 */
export function buildTurnaroundBarEvents(args: {
	progressionType: ChordProgressionType;
	targetKey: PitchClass;
	backingStyle: BackingStyle;
	tempo: number;
	swing: number;
	ppq: number;
	beatsPerBar: number;
}): TurnaroundEvent[] {
	const { progressionType, targetKey, backingStyle, tempo, swing, ppq, beatsPerBar } = args;
	const style = BACKING_STYLES[backingStyle];
	const harmony = turnaroundHarmony(progressionType, targetKey, beatsPerBar);

	const generated = generateBacking(harmony, style, {
		phraseId: `turnaround:${progressionType}:${targetKey}`,
		tempo,
		ppq,
		beatsPerBar,
		swing: resolveBackingSwing(swing, style, tempo)
	});

	const barTicks = beatsPerBar * ppq;
	const events: TurnaroundEvent[] = [];
	const push = (time: string, hit: BackingHit): void => {
		const tick = parseInt(time, 10);
		if (Number.isNaN(tick)) return;
		const clamped = Math.max(0, tick);
		if (clamped >= barTicks) return;
		events.push({ tickOffset: clamped, hit });
	};

	for (const ev of generated.bassEvents) {
		push(ev.time, { kind: 'bass', midi: ev.midi, velocity: ev.velocity, duration: ev.duration });
	}
	for (const ev of generated.compEvents) {
		push(ev.time, { kind: 'comp', notes: ev.notes, velocity: ev.velocity, duration: ev.duration });
	}
	for (const ev of generated.drumEvents) {
		push(ev.time, { kind: 'drum', drum: ev.drum, velocity: ev.velocity });
	}

	events.sort((a, b) => a.tickOffset - b.tickOffset);
	return events;
}
