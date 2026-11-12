/** Bounded pitch-only proposals on an already selected native bass rhythm. */
import type { BassEvent } from './backing-generation';
import type { BassPulse } from './backing-bass-continuation';
import type { BackingStyle } from '$lib/types/instruments';
import { createRng, seedFrom } from './generation-rng';

export interface BassDelayedRootPlan {
	readonly startMidi: number;
	readonly rootMidi: number;
	readonly rootOffset: 1 | 2;
	readonly degree: 'third' | 'fifth';
}
export interface BassDelayedRootTrace {
	readonly version: 1;
	readonly barIndex: number;
	readonly degree: BassDelayedRootPlan['degree'];
	readonly rootPc: number;
	readonly notes: readonly [BassPulse, BassPulse];
}

/** The caller owns repeated-harmony, form, response and approach admission. */
export function planBassDelayedRoot(input: {
	phraseId: string; tempo: number; barIndex: number; style: BackingStyle;
	rootPc: number; third: number; fifth: number; previousMidi: number | null;
	rootOffset: 1 | 2; repeatedHarmony: boolean; events: readonly BassEvent[];
}): BassDelayedRootPlan | undefined {
	const { events, rootPc, rootOffset, previousMidi } = input, start = input.barIndex * 4;
	const entrance = events.find(event => event.absBeat === start);
	const landing = events.find(event => event.absBeat === start + rootOffset);
	if (!entrance || !landing || previousMidi === null || !Number.isInteger(previousMidi) ||
		!events.every(event => Number.isInteger(event.midi) && event.midi >= 28 && event.midi <= 55) ||
		events.some(event => event.absBeat > start && event.absBeat < landing.absBeat && event.midi % 12 === rootPc)) return;
	const rng = createRng(seedFrom(input.phraseId, input.tempo, 'bass-delayed-root', input.barIndex));
	if (!rng.chance(input.repeatedHarmony ? .65 : .5)) return;
	const degrees = input.style === 'bossa-nova' ? ['fifth'] as const : ['third', 'fifth'] as const;
	const startsOnRoot = entrance.midi % 12 === rootPc;
	// A changed-chord entrance belongs to its preceding approach. Retain it when it
	// already targets a third/fifth. Bossa may repeat an actually played common fifth.
	if (startsOnRoot && !input.repeatedHarmony && (input.style !== 'bossa-nova' || previousMidi !== landing.midi)) return;
	const candidates = degrees.flatMap(degree => Array.from({ length: 28 }, (_, i) => i + 28)
		.filter(midi => midi % 12 === (rootPc + input[degree]) % 12 &&
			Math.abs(midi - previousMidi) <= (startsOnRoot ? 5 : 7) && Math.abs(midi - entrance.midi) <= 5 &&
			(startsOnRoot || midi === entrance.midi) && (input.style !== 'bossa-nova' || midi === landing.midi))
		.flatMap(startMidi => Array.from({ length: 28 }, (_, i) => i + 28)
			.filter(rootMidi => rootMidi % 12 === rootPc && Math.abs(rootMidi - startMidi) <= 6 &&
				(!startsOnRoot || rootMidi === entrance.midi) && (startMidi !== entrance.midi || rootMidi !== landing.midi))
			.map(rootMidi => ({ startMidi, rootMidi, rootOffset, degree }))));
	const safe = candidates.filter(candidate => {
		const pitches = events.map(event => event === entrance ? candidate.startMidi : event === landing ? candidate.rootMidi : event.midi);
		return pitches.every((midi, index) => index === 0 || Math.abs(midi - pitches[index - 1]) <= 7);
	});
	if (!safe.length) return;
	return rng.weighted(safe.map(value => ({ value, weight: 1 / (1 + Math.abs(value.startMidi - previousMidi)) })));
}

/** Evidence is built from the accepted emitted pulses, never from the proposal alone. */
export function bassDelayedRootTrace(barIndex: number, rootPc: number, plan: BassDelayedRootPlan,
	entrance: BassEvent, landing: BassEvent): BassDelayedRootTrace {
	const pulse = ({ absBeat, midi, time }: BassEvent): BassPulse => Object.freeze({ absBeat, midi, time });
	return Object.freeze({ version: 1, barIndex, degree: plan.degree, rootPc,
		notes: Object.freeze([pulse(entrance), pulse(landing)]) as readonly [BassPulse, BassPulse] });
}
