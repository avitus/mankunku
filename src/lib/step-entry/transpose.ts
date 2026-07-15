import type { Note, PitchClass, Phrase } from '$lib/types/music';
import type { InstrumentConfig } from '$lib/types/instruments';
import { writtenKeyToConcert } from '$lib/music/transposition';
import { transposeLick } from '$lib/phrases/library-loader';

/**
 * Transpose a lick's notes when the user changes the Key dropdown in the editor.
 *
 * The dropdown is in WRITTEN pitch; entered notes are stored in CONCERT pitch.
 * We convert both keys to concert, then delegate to `transposeLick` — the same
 * routine the rest of the app uses — so the chromatic interval and the octave
 * placement match exactly how the lick will later play. `transposeLick` octave-
 * fits the result into the instrument's range (`concertRangeLow`..`rangeHigh`),
 * preserving rests and per-note metadata.
 *
 * Returns a fresh array (safe to assign straight back to `$state`). No-ops to a
 * copy when the key is unchanged or there are no notes.
 *
 * @param rangeHigh effective highest concert MIDI note (see `getEffectiveHighestNote`)
 */
export function transposeNotesForKeyChange(
	notes: Note[],
	oldWrittenKey: PitchClass,
	newWrittenKey: PitchClass,
	instrument: InstrumentConfig,
	rangeHigh: number
): Note[] {
	if (notes.length === 0 || oldWrittenKey === newWrittenKey) {
		return notes.map((n) => ({ ...n }));
	}

	const oldConcertKey = writtenKeyToConcert(oldWrittenKey, instrument);
	const newConcertKey = writtenKeyToConcert(newWrittenKey, instrument);

	// Minimal carrier phrase: only key + notes drive the note transposition.
	const phrase: Phrase = {
		id: '',
		name: '',
		timeSignature: [4, 4],
		key: oldConcertKey,
		notes,
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'user',
		tags: [],
		source: 'user-entered'
	};

	const transposed = transposeLick(phrase, newConcertKey, instrument.concertRangeLow, rangeHigh);
	return transposed.notes.map((n) => ({ ...n }));
}
