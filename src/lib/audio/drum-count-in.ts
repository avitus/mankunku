/**
 * The drummer's count-off before a tune (2026-10-22, Andy: nothing told the
 * player when the tune was coming). Pure data — `playPhrase` schedules it.
 *
 * Length follows the tempo: one bar, two bars above 150 BPM, where a single
 * bar goes by too fast to lock the time in. The pattern is the jazz count-off
 * "one … two … one two three four": over two bars the opening bar sounds the
 * half-bar pulse and the last bar every beat; a one-bar count is that last
 * bar alone. An odd meter has no half-bar, so its opening bar sounds only the
 * downbeat ("one … | one two three" in a waltz).
 *
 * The voice is the cross-stick, the kit's nearest sample to sticks clicked
 * together, at a level that carries over a silent room without a crash's bark.
 */

import type { DrumVoice } from './backing-styles';

/** Tempos above this count in for two bars. */
export const TWO_BAR_COUNT_IN_ABOVE_BPM = 150;

/** The kit voice the count-off is played on. */
export const COUNT_IN_VOICE: DrumVoice = 'crossstick';
/** The counted pulse of the opening bar leans a little harder than the quarters. */
const PULSE_VELOCITY = 0.7;
const QUARTER_VELOCITY = 0.6;

export interface DrumCountInHit {
	/** Transport ticks from the start of the count-in. */
	tick: number;
	drum: DrumVoice;
	velocity: number;
}

/** Bars of count-in for a tune at `tempo` BPM. */
export function countInBarsForTempo(tempo: number): 1 | 2 {
	return tempo > TWO_BAR_COUNT_IN_ABOVE_BPM ? 2 : 1;
}

/**
 * The count-off's hits for `bars` bars of `beatsPerBar` quarter notes (the
 * engine's bar). Every bar before the last sounds the half-bar pulse; the
 * last bar sounds every beat.
 */
export function drumCountInHits(bars: number, beatsPerBar: number, ppq: number): DrumCountInHit[] {
	const hits: DrumCountInHit[] = [];
	const pulse = beatsPerBar % 2 === 0 ? beatsPerBar / 2 : beatsPerBar;
	for (let bar = 0; bar < bars; bar++) {
		const last = bar === bars - 1;
		const step = last ? 1 : pulse;
		for (let beat = 0; beat < beatsPerBar; beat += step) {
			hits.push({
				tick: (bar * beatsPerBar + beat) * ppq,
				drum: COUNT_IN_VOICE,
				velocity: last ? QUARTER_VELOCITY : PULSE_VELOCITY
			});
		}
	}
	return hits;
}
