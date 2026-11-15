import { describe, expect, it } from 'vitest';
import { assessPhraseFit, comparePhraseFit } from '$lib/tunes/phrase-fit';
import { makePhrase } from '../../helpers/lick-builders';
import { seg } from '../../helpers/tune-fixtures';
import type { Fraction, Note, Phrase } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';

/** A note at an authored whole-note offset. */
function note(pitch: number | null, offset: Fraction, duration: Fraction): Note { return { pitch, offset, duration }; }
/** A tonic-major line; no rewrite or inferred chord sequence. */
function line(notes: Note[], overrides: Partial<Phrase> = {}): Phrase { return makePhrase({ notes, ...overrides }); }
const tonic = [seg('C', 'maj7', [0, 1], [4, 1])];
/** Score a line over the supplied real chord timeline, without persistence. */
function score(notes: Note[], harmony = tonic, insertion: Fraction = [0, 1]) {
	return assessPhraseFit(line(notes), 'C', insertion, harmony, [4, 4])!;
}

describe('phrase-aware support at the actual insertion', () => {
	it('prefers a held chord tone on the downbeat over a held unwritten tension, without excluding either', () => {
		const stable = score([note(64, [0, 1], [1, 1])]);
		const tension = score([note(65, [0, 1], [1, 1])]);
		expect(stable).toMatchObject({ score: 1, strongBeatTargets: 1, strongBeatAttacks: 1, heldBeats: 4, endingOnChordTone: true });
		expect(tension.score).toBe(0);
		expect(comparePhraseFit(stable, tension)).toBeLessThan(0);
	});

	it('evaluates a sustained note on both sides of the chord change', () => {
		const harmony = [seg('C', 'maj7', [0, 1], [1, 2]), seg('Db', 'maj7', [1, 2], [1, 2])];
		const held = score([note(67, [0, 1], [1, 1])], harmony);
		expect(held).toMatchObject({ supportedHeldBeats: 2, heldBeats: 4, endingOnChordTone: false });
		expect(held.score).toBeGreaterThan(0);
		expect(held.score).toBeLessThan(1);
	});

	it('credits a short chromatic approach resolving by step, but not a rest or octave leap', () => {
		const resolved = score([note(63, [1, 8], [1, 8]), note(64, [1, 4], [1, 4])]);
		const gap = score([note(63, [1, 8], [1, 8]), note(null, [1, 4], [1, 4]), note(64, [1, 2], [1, 4])]);
		const leap = score([note(63, [1, 8], [1, 8]), note(76, [1, 4], [1, 4])]);
		expect(resolved).toMatchObject({ approaches: 1, resolvedApproaches: 1, score: 1 });
		expect(gap.resolvedApproaches).toBe(0);
		expect(leap.resolvedApproaches).toBe(0);
		expect(comparePhraseFit(resolved, leap)).toBeLessThan(0);
	});

	it('keeps the tune beat grid when a phrase begins mid-bar or with a pickup rest', () => {
		const n = [note(null, [0, 1], [1, 8]), note(63, [1, 8], [1, 8]), note(64, [1, 4], [1, 4])];
		expect(score(n).strongBeatAttacks).toBe(0);
		expect(score(n, tonic, [1, 4]).strongBeatTargets).toBe(1);
	});

	it('treats tied continuations as one attack and does not mutate notes or chords', () => {
		const phrase = line([{ ...note(67, [0, 1], [1, 2]), tied: true }, note(67, [1, 2], [1, 2])]);
		const before = JSON.stringify({ phrase, tonic });
		expect(assessPhraseFit(phrase, 'C', [0, 1], tonic, [4, 4])).toEqual(score([note(67, [0, 1], [1, 1])]));
		expect(JSON.stringify({ phrase, tonic })).toBe(before);
	});

	it('uses written additions and alterations rather than an unrelated scaleId', () => {
		const altered = [{ ...tonic[0], symbol: 'C7#9', scaleId: 'minor.whatever' }];
		expect(score([note(63, [0, 1], [1, 1])], altered).score).toBe(1);
		expect(score([note(63, [0, 1], [1, 1])], [{ ...altered[0], symbol: 'C7' }]).score).toBe(0);
		expect(score([note(63, [0, 1], [1, 1])], [{ ...altered[0], scaleId: 'major.ionian' }])).toEqual(score([note(63, [0, 1], [1, 1])], altered));
	});

	it('judges the ending against its last sounding chord, not the next chord or trailing padding', () => {
		const harmony = [seg('C', 'maj7', [0, 1], [1, 1]), seg('Db', 'maj7', [1, 1], [1, 1])];
		expect(score([note(67, [0, 1], [1, 1]), note(null, [1, 1], [1, 1])], harmony).endingOnChordTone).toBe(true);
	});

	it.each(PITCH_CLASSES)('is invariant under concert transposition to %s', target => {
		const notes = [note(63, [1, 8], [1, 8]), note(64, [1, 4], [3, 4])];
		const transposed = tonic.map(h => ({ ...h, chord: { ...h.chord, root: target } }));
		expect(assessPhraseFit(line(notes), target, [0, 1], transposed, [4, 4])).toEqual(score(notes));
	});

	it('uses the stored lick tonic, not an assumed C', () => {
		const phrase = line([note(66, [0, 1], [1, 1])], { key: 'D' });
		const harmony = [seg('F', 'maj7', [0, 1], [1, 1])];
		expect(assessPhraseFit(phrase, 'F', [0, 1], harmony, [4, 4])?.score).toBe(1);
	});

	it.each([
		[{ ...tonic[0], symbol: 'Calt' }],
		[{ ...tonic[0], symbol: 'nonsense' }],
		[seg('C', 'maj7', [1, 2], [1, 2])],
		[seg('C', 'maj7', [0, 1], [1, 2])],
		[tonic[0], seg('G', '7', [1, 2], [1, 2])]
	].map(harmony => ({ harmony })))('declines incomplete or contradictory chord evidence: $harmony', ({ harmony }) => {
		expect(assessPhraseFit(line([note(64, [0, 1], [1, 1])]), 'C', [0, 1], harmony, [4, 4])).toBeNull();
	});

	it('does not infer across a form boundary and treats absent evidence as neutral', () => {
		expect(assessPhraseFit(line([note(64, [0, 1], [1, 1])]), 'C', [4, 1], tonic, [4, 4])).toBeNull();
		expect(comparePhraseFit(undefined, null)).toBe(0);
		expect(comparePhraseFit(score([note(64, [0, 1], [1, 1])]), null)).toBeLessThan(0);
		expect(comparePhraseFit(score([note(65, [0, 1], [1, 1])]), null)).toBeGreaterThan(0);
	});

	it.each([4, 8, 16])('uses dotted beats in compound 6/%i meter', unit => {
		const notes = [note(64, [3, unit], [3, unit])];
		expect(assessPhraseFit(line(notes, { timeSignature: [6, unit] }), 'C', [0, 1], tonic, [6, unit]))
			.toMatchObject({ strongBeatAttacks: 1, heldBeats: 1 });
	});

	it('uses only the downbeat in asymmetric meter', () => {
		const notes = [note(64, [3, 8], [3, 8])];
		expect(assessPhraseFit(line(notes, { timeSignature: [7, 8] }), 'C', [0, 1], tonic, [7, 8])?.strongBeatAttacks).toBe(0);
	});

	it('declines invalid note timing, polyphony, mismatched meter, and silence-only phrases', () => {
		for (const notes of [[note(64, [-1, 4], [1, 1])], [note(64, [0, 1], [0, 1])],
			[note(64, [0, 1], [1, 1]), note(67, [1, 2], [1, 1])], [note(null, [0, 1], [1, 1])]]) {
			expect(assessPhraseFit(line(notes), 'C', [0, 1], tonic, [4, 4])).toBeNull();
		}
		expect(assessPhraseFit(line([note(64, [0, 1], [1, 1])]), 'C', [0, 1], tonic, [3, 4])).toBeNull();
	});
});
