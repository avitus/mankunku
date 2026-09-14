/**
 * The OMR bridge: an untrusted `.omr.json` (from `python -m omr transcribe`)
 * becomes per-system model responses for the existing import fusion.
 *
 * Unit conventions under test: OMR onsets/durations are [num, den] fractions
 * of a WHOLE NOTE; ModelBar melody is [beat, durationBeats, pitch, tied?]
 * in units of the DECLARED meter denominator.
 */
import { describe, expect, it } from 'vitest';
import {
	omrKeyToFifths,
	omrNormalized,
	omrSystemResponses,
	validateOmrTranscription
} from '$lib/tunes/import/omr-transcription';

function note(
	pitch: string | null,
	onset: [number, number],
	duration: [number, number],
	extra: Record<string, unknown> = {}
) {
	return {
		spelled_pitch: pitch,
		midi: pitch ? 60 : null,
		onset,
		duration,
		tied_to_next: false,
		tuplet: null,
		is_rest: pitch === null,
		...extra
	};
}

function measure(number: number, notes: unknown[], extra: Record<string, unknown> = {}) {
	return {
		number,
		chords: [],
		notes,
		start_repeat: false,
		end_repeat: false,
		ending: null,
		rehearsal_mark: null,
		meter: [4, 4],
		raw_unparsed: [],
		warnings: [],
		...extra
	};
}

function payload(measures: unknown[], extra: Record<string, unknown> = {}) {
	return {
		omr_version: '0.1.0',
		backend: { name: 'legato_v1' },
		normalized: {
			title: 'Test Chart',
			composer: null,
			key_signature: 'D',
			time_signature: [4, 4],
			tempo: null,
			measures,
			text_annotations: [],
			warnings: [],
			...extra
		}
	};
}

describe('validateOmrTranscription', () => {
	it('accepts a well-formed CLI payload', () => {
		const result = validateOmrTranscription(
			payload([measure(1, [note('D5', [0, 1], [1, 4])])])
		);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it('rejects non-objects and missing normalized', () => {
		expect(validateOmrTranscription('nope').valid).toBe(false);
		expect(validateOmrTranscription(null).valid).toBe(false);
		expect(validateOmrTranscription({ omr_version: '0.1.0' }).valid).toBe(false);
	});

	it('rejects unsafe title content', () => {
		const bad = payload([measure(1, [])], { title: '<script>alert(1)</script>' });
		const result = validateOmrTranscription(bad);
		expect(result.valid).toBe(false);
		expect(result.errors.join(' ')).toMatch(/title/);
	});

	it('rejects malformed note fractions and pitches', () => {
		const badFraction = payload([measure(1, [note('D5', [0, 0], [1, 4])])]);
		expect(validateOmrTranscription(badFraction).valid).toBe(false);

		const badPitch = payload([measure(1, [note('not-a-pitch-string-way-too-long', [0, 1], [1, 4])])]);
		expect(validateOmrTranscription(badPitch).valid).toBe(false);
	});

	it('rejects malformed measure-level fields the mapper consumes', () => {
		// A non-array `warnings` would make the mapper's for..of throw at
		// fusion time — long after validation claimed the payload was fine.
		expect(validateOmrTranscription(payload([measure(1, [], { warnings: {} })])).valid).toBe(false);
		expect(
			validateOmrTranscription(payload([measure(1, [], { warnings: [{ message: 5 }] })])).valid
		).toBe(false);
		expect(
			validateOmrTranscription(payload([measure(1, [], { raw_unparsed: 'junk' })])).valid
		).toBe(false);
		expect(
			validateOmrTranscription(payload([measure(1, [], { start_repeat: 'true' })])).valid
		).toBe(false);
		expect(validateOmrTranscription(payload([measure(1, [], { end_repeat: 1 })])).valid).toBe(
			false
		);
		expect(
			validateOmrTranscription(payload([measure(1, [], { ending: 'first' })])).valid
		).toBe(false);
	});

	it('rejects string booleans on note flags — truthy coercion would drop notes or invent ties', () => {
		const restStr = payload([measure(1, [note('C4', [0, 1], [1, 4], { is_rest: 'false' })])]);
		expect(validateOmrTranscription(restStr).valid).toBe(false);

		const tieStr = payload([
			measure(1, [note('C4', [0, 1], [1, 4], { tied_to_next: 'false' })])
		]);
		expect(validateOmrTranscription(tieStr).valid).toBe(false);
	});

	it('accepts absent optional measure fields (mapper defaults cover them)', () => {
		const bare = payload([
			{ number: 1, notes: [note('C4', [0, 1], [1, 4])] } // no flags, no warnings
		]);
		expect(validateOmrTranscription(bare).valid).toBe(true);
	});

	it('accepts a bare normalized document with no CLI wrapper, and omrNormalized returns it as-is', () => {
		const bare = payload([measure(1, [note('C4', [0, 1], [1, 4])])]).normalized;
		expect(validateOmrTranscription(bare).valid).toBe(true);
		expect(omrNormalized(bare)).toBe(bare);
		// The wrapped form unwraps to the same object.
		expect(omrNormalized({ normalized: bare })).toBe(bare);
	});

	it('names the measure with an invalid number and stops listing after 40 errors', () => {
		// A hostile or garbled file could carry thousands of bad measures; the
		// error list is bounded so the UI never renders a wall of them.
		const result = validateOmrTranscription(
			payload(Array.from({ length: 60 }, () => ({ number: 0, notes: [] })))
		);
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toBe('measure 1 has an invalid number');
		expect(result.errors[result.errors.length - 1]).toBe('further errors suppressed');
		expect(result.errors.length).toBeLessThan(60);
	});

	it('enforces DoS caps on measure and note counts', () => {
		const tooManyMeasures = payload(
			Array.from({ length: 513 }, (_, i) => measure(i + 1, []))
		);
		expect(validateOmrTranscription(tooManyMeasures).valid).toBe(false);

		const tooManyNotes = payload([
			measure(1, Array.from({ length: 129 }, () => note('C4', [0, 1], [1, 8])))
		]);
		expect(validateOmrTranscription(tooManyNotes).valid).toBe(false);
	});
});

describe('omrKeyToFifths', () => {
	it('maps canonical majors', () => {
		expect(omrKeyToFifths('C')).toBe(0);
		expect(omrKeyToFifths('D')).toBe(2);
		expect(omrKeyToFifths('Eb')).toBe(-3);
		expect(omrKeyToFifths('F#')).toBe(6);
	});

	it('maps enharmonic spellings the app does not use', () => {
		expect(omrKeyToFifths('Gb')).toBe(-6);
		expect(omrKeyToFifths('C#')).toBe(7);
		expect(omrKeyToFifths('Cb')).toBe(-7);
	});

	it('maps minors to the relative-major signature', () => {
		expect(omrKeyToFifths('Am')).toBe(0);
		expect(omrKeyToFifths('F#m')).toBe(3);
		expect(omrKeyToFifths('Dmin')).toBe(-1);
		expect(omrKeyToFifths('c minor')).toBe(-3);
	});

	it('reads unicode accidentals the way it reads ASCII ones', () => {
		expect(omrKeyToFifths('F♯')).toBe(6);
		expect(omrKeyToFifths('B♭')).toBe(-2);
		expect(omrKeyToFifths('E♭m')).toBe(-6);
	});

	it('returns null for unparseable keys', () => {
		expect(omrKeyToFifths('')).toBeNull();
		expect(omrKeyToFifths('none')).toBeNull();
		expect(omrKeyToFifths('H')).toBeNull();
		expect(omrKeyToFifths('D dorian')).toBeNull();
	});
});

describe('omrSystemResponses', () => {
	const meter: [number, number] = [4, 4];

	it('slices flat measures into per-system chunks by bar counts', () => {
		const omr = omrNormalized(payload([
			measure(1, [note('D5', [0, 1], [1, 4])]),
			measure(2, [note('E5', [0, 1], [1, 4])]),
			measure(3, [note('F#5', [0, 1], [1, 4])])
		]));

		const { responses } = omrSystemResponses(omr, [2, 1], meter);

		expect(responses).toHaveLength(2);
		expect(responses[0]?.bars).toHaveLength(2);
		expect(responses[1]?.bars).toHaveLength(1);
		expect(responses[1]?.bars[0].melody[0][2]).toBe('F#5');
	});

	it('converts whole-note fractions to declared-denominator beats', () => {
		const omr = omrNormalized(payload([
			measure(1, [
				note('D5', [0, 1], [1, 4]), // quarter at beat 0
				note('E5', [1, 4], [1, 8]), // eighth at beat 1
				note('F5', [3, 8], [1, 12]) // triplet eighth at beat 1.5
			])
		]));

		const { responses } = omrSystemResponses(omr, [1], meter);
		const melody = responses[0]!.bars[0].melody;

		expect(melody[0]).toEqual([0, 1, 'D5']);
		expect(melody[1]).toEqual([1, 0.5, 'E5']);
		expect(melody[2][0]).toBeCloseTo(1.5, 10);
		expect(melody[2][1]).toBeCloseTo(1 / 3, 10);
	});

	it('drops rests and marks ties', () => {
		const omr = omrNormalized(payload([
			measure(1, [
				note(null, [0, 1], [1, 4]),
				note('G4', [1, 4], [1, 4], { tied_to_next: true }),
				note('G4', [1, 2], [1, 2])
			])
		]));

		const { responses } = omrSystemResponses(omr, [1], meter);
		const melody = responses[0]!.bars[0].melody;

		expect(melody).toHaveLength(2);
		expect(melody[0]).toEqual([1, 1, 'G4', true]);
		expect(melody[1]).toEqual([2, 2, 'G4']);
	});

	it('carries repeats/endings and key signature', () => {
		const omr = omrNormalized(payload([
			measure(1, [], { start_repeat: true }),
			measure(2, [], { end_repeat: true, ending: 1 })
		]));

		const { responses } = omrSystemResponses(omr, [2], meter);
		const bars = responses[0]!.bars;

		expect(bars[0].startRepeat).toBe(true);
		expect(bars[1].endRepeat).toBe(true);
		expect(bars[1].ending).toBe(1);
		expect(responses[0]!.keySignature).toEqual({ fifths: 2 });
		expect(responses[0]!.timeSignature).toEqual([4, 4]);
	});

	it('returns null for systems the transcription cannot cover', () => {
		const omr = omrNormalized(payload([measure(1, []), measure(2, []), measure(3, [])]));

		const { responses, warnings } = omrSystemResponses(omr, [2, 2, 4], meter);

		expect(responses[0]).not.toBeNull();
		expect(responses[1]).toBeNull(); // only 1 of 2 bars available
		expect(responses[2]).toBeNull();
		expect(warnings.join(' ')).toMatch(/3 .*8/); // totals named in the mismatch warning
	});

	it('warns when the transcription has more measures than the page', () => {
		const omr = omrNormalized(payload([measure(1, []), measure(2, [])]));

		const { responses, warnings } = omrSystemResponses(omr, [1], meter);

		expect(responses[0]).not.toBeNull();
		expect(warnings.length).toBeGreaterThan(0);
	});

	it('forwards per-measure OMR warnings with system-local bar prefixes', () => {
		const omr = omrNormalized(payload([
			measure(1, []),
			measure(2, [], {
				raw_unparsed: ['??junk??'],
				warnings: [{ code: 'UNPARSEABLE_REGION', message: 'unparseable ABC span', measure: 2 }]
			})
		]));

		const { responses } = omrSystemResponses(omr, [2], meter);

		expect(responses[0]!.warnings.some((w) => w.startsWith('bar 2:'))).toBe(true);
	});
});

describe('omrSystemResponses — pickup bars', () => {
	const meter: [number, number] = [4, 4];

	it('right-aligns a short first measure as a pickup with its exact length', () => {
		// A one-beat anacrusis the model transcribed as a one-beat measure.
		const omr = omrNormalized(payload([
			measure(1, [note('G4', [0, 1], [1, 4])]),
			measure(2, [note('C5', [0, 1], [1, 1])])
		]));
		const { responses, warnings } = omrSystemResponses(omr, [2], meter);
		const [pickup, full] = responses[0]!.bars;
		expect(pickup.pickup).toBe(true);
		expect(pickup.pickupBeats).toBe(1);
		expect(pickup.melody).toEqual([[3, 1, 'G4']]);
		expect(full.pickup).toBe(false);
		expect(full.melody).toEqual([[0, 4, 'C5']]);
		expect(warnings).toEqual([]);
		expect(responses[0]!.warnings).toEqual([]);
	});

	it('keeps a rest inside the pickup: the length is the measure content, not the first note', () => {
		// Eighth rest + eighth note = a one-beat pickup whose note is on the and-of-4.
		const omr = omrNormalized(payload([
			measure(1, [note(null, [0, 1], [1, 8]), note('G4', [1, 8], [1, 8])]),
			measure(2, [note('C5', [0, 1], [1, 1])])
		]));
		const { responses } = omrSystemResponses(omr, [2], meter);
		expect(responses[0]!.bars[0].pickupBeats).toBe(1);
		expect(responses[0]!.bars[0].melody).toEqual([[3.5, 0.5, 'G4']]);
	});

	it('leaves a full first measure with a leading rest to the assembler heuristics', () => {
		// LEGATO's own habit (Donna Lee): the anacrusis right-aligned inside a
		// full measure. Nothing to shift; the late-onset rule flags it later.
		const omr = omrNormalized(payload([
			measure(1, [note(null, [0, 1], [1, 2]), note('A5', [1, 2], [1, 2])]),
			measure(2, [note('C5', [0, 1], [1, 1])])
		]));
		const { responses } = omrSystemResponses(omr, [2], meter);
		expect(responses[0]!.bars[0].pickup).toBe(false);
		expect(responses[0]!.bars[0].pickupBeats).toBeUndefined();
		expect(responses[0]!.bars[0].melody).toEqual([[2, 2, 'A5']]);
	});

	it('does not read a short LATER measure as a pickup — it is flagged for review instead', () => {
		const omr = omrNormalized(payload([
			measure(1, [note('C5', [0, 1], [1, 1])]),
			measure(2, [note('G4', [0, 1], [1, 2])]),
			measure(3, [note('C5', [0, 1], [1, 1])])
		]));
		const { responses } = omrSystemResponses(omr, [3], meter);
		const short = responses[0]!.bars[1];
		expect(short.pickup).toBe(false);
		expect(short.melody).toEqual([[0, 2, 'G4']]);
		expect(responses[0]!.warnings).toEqual(['bar 2: the transcription fills 2 of 4 beats — check the rhythm']);
	});

	it('accepts a short final bar that complements the pickup — together they make one bar', () => {
		const omr = omrNormalized(payload([
			measure(1, [note('G4', [0, 1], [1, 4])]),
			measure(2, [note('C5', [0, 1], [1, 1])]),
			measure(3, [note('C5', [0, 1], [3, 4])])
		]));
		const { responses } = omrSystemResponses(omr, [3], meter);
		expect(responses[0]!.bars[0].pickup).toBe(true);
		expect(responses[0]!.bars[2].pickup).toBe(false);
		expect(responses[0]!.warnings).toEqual([]);
	});

	it('flags a short final bar that does NOT complement the pickup — a beat is missing somewhere', () => {
		const omr = omrNormalized(payload([
			measure(1, [note('G4', [0, 1], [1, 4])]),
			measure(2, [note('C5', [0, 1], [1, 1])]),
			measure(3, [note('C5', [0, 1], [1, 2])])
		]));
		const { responses } = omrSystemResponses(omr, [3], meter);
		expect(responses[0]!.warnings).toEqual(['bar 3: the transcription fills 2 of 4 beats — check the rhythm']);
	});

	it('flags a short MIDDLE bar even when it would complement the pickup — only the final bar may', () => {
		// 1 + 3 = one full bar, but a 3-beat bar in the middle of the form is
		// a misread: the complement exemption belongs to the closing bar alone.
		const omr = omrNormalized(payload([
			measure(1, [note('G4', [0, 1], [1, 4])]),
			measure(2, [note('C5', [0, 1], [3, 4])]),
			measure(3, [note('C5', [0, 1], [1, 1])])
		]));
		const { responses } = omrSystemResponses(omr, [3], meter);
		expect(responses[0]!.bars[0].pickup).toBe(true);
		expect(responses[0]!.warnings).toEqual(['bar 2: the transcription fills 3 of 4 beats — check the rhythm']);
	});

	it('exempts the transcription\'s final bar, not the last bar of each system', () => {
		// A 3-beat bar closing system 1 complements the 1-beat pickup
		// arithmetically, but the form goes on — it is a misread. The one at
		// the very end of system 2 is the real closing complement. Warnings
		// stay numbered system-locally.
		const omr = omrNormalized(payload([
			measure(1, [note('G4', [0, 1], [1, 4])]),
			measure(2, [note('C5', [0, 1], [1, 1])]),
			measure(3, [note('C5', [0, 1], [3, 4])]),
			measure(4, [note('C5', [0, 1], [1, 1])]),
			measure(5, [note('C5', [0, 1], [3, 4])])
		]));
		const { responses } = omrSystemResponses(omr, [3, 2], meter);
		expect(responses[0]!.bars[0].pickup).toBe(true);
		expect(responses[1]!.bars[0].pickup).toBe(false);
		expect(responses.map((r) => r!.warnings)).toEqual([
			['bar 3: the transcription fills 3 of 4 beats — check the rhythm'],
			[]
		]);
	});

	it('flags a lone short measure — with no form after it, it is a misread, not a pickup', () => {
		const omr = omrNormalized(payload([measure(1, [note('G4', [0, 1], [1, 2])])]));
		const { responses } = omrSystemResponses(omr, [1], meter);
		expect(responses[0]!.bars[0].pickup).toBe(false);
		expect(responses[0]!.warnings).toEqual(['bar 1: the transcription fills 2 of 4 beats — check the rhythm']);
	});

	it('does not read an empty first measure as a pickup', () => {
		const omr = omrNormalized(payload([
			measure(1, []),
			measure(2, [note('C5', [0, 1], [1, 1])])
		]));
		const { responses } = omrSystemResponses(omr, [2], meter);
		expect(responses[0]!.bars[0].pickup).toBe(false);
		expect(responses[0]!.bars[0].melody).toEqual([]);
	});
});
