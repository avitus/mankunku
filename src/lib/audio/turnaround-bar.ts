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
import { turnaroundHarmony } from '$lib/data/progressions';
import { BACKING_STYLES, type DrumVoice } from './backing-styles';
import { generateBacking, resolveBackingSwing } from './backing-generation';

/**
 * The bar's harmony lives with the progression templates
 * (`data/progressions.ts`) so the lead-sheet reading pause can vamp the same
 * bar inside a super phrase without the state layer importing audio code.
 */
export { turnaroundHarmony };

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
