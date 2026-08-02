import type { DetectedNote } from '$lib/types/audio';
import type { LickFeature } from './index-format';

const SIXTEENTHS_PER_BEAT = 4;

/**
 * Encode a live segmented-note stream into the matcher's transposition-
 * invariant feature space. Mirrors `encodeNotes` exactly, but from mic-time
 * seconds instead of notated fractions: intervals are raw semitone deltas
 * (direction and octaves preserved), IOIs are tempo-quantized to 16th-note
 * ticks with the same round-and-clamp rule as `quantizeIoi`. The matcher's
 * ±1-tick rhythm tolerance absorbs moderate swing.
 */
export function featureFromDetected(notes: readonly DetectedNote[], tempo: number): LickFeature {
	const sixteenthSec = 60 / tempo / SIXTEENTHS_PER_BEAT;

	const intervals: number[] = [];
	const iois: number[] = [];
	for (let i = 1; i < notes.length; i++) {
		intervals.push(notes[i].midi - notes[i - 1].midi);
		const deltaSec = notes[i].onsetTime - notes[i - 1].onsetTime;
		iois.push(Math.max(1, Math.round(deltaSec / sixteenthSec)));
	}

	let totalBeats = 0;
	if (notes.length > 0) {
		const first = notes[0];
		const last = notes[notes.length - 1];
		const spanSec = last.onsetTime + last.duration - first.onsetTime;
		totalBeats = spanSec / (60 / tempo);
	}

	return {
		intervals,
		iois,
		noteCount: notes.length,
		totalBeats,
		keyPc: 0
	};
}
