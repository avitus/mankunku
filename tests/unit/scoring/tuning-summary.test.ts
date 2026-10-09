import { describe, expect, it } from 'vitest';
import { cleanTuningSamples, type TuningSample } from '$lib/scoring/tuning';
import { STEADY_TAKES, summarizeTuning, tuningSummaryLines } from '$lib/scoring/tuning-summary';
import type { DetectedNote } from '$lib/types/audio';
import type { NoteResult } from '$lib/types/scoring';

/** A matched note whose detection can be made unreliable per test. */
function note(pitch: number, cents: number, overrides: Partial<DetectedNote> = {}): NoteResult {
	return {
		expected: { pitch, offset: [0, 1], duration: [1, 4] },
		detected: { midi: pitch, cents, onsetTime: 0, duration: 0.4, clarity: 0.98, ...overrides },
		pitchScore: 1, rhythmScore: 1, missed: false, extra: false
	};
}

/** `count` takes of one note at the given cents (cycled). */
function takes(midi: number, cents: number[], count = cents.length): TuningSample[] {
	return Array.from({ length: count }, (_, i) => ({ midi, cents: cents[i % cents.length] }));
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Written names for the tests: plain sharps, octave included. */
const name = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

describe('clean tuning samples', () => {
	it('keeps the octave each note was played in', () => {
		expect(cleanTuningSamples([note(62, 3), note(74, 24)])).toEqual([
			{ midi: 62, cents: 3 },
			{ midi: 74, cents: 24 }
		]);
	});

	it.each([
		{ clarity: 0.8 }, { duration: 0.05 }, { ghost: true as const },
		{ cents: NaN }, { cents: 51 }, { midi: 61 }
	])('drops what the sharp/flat cue drops: %j', overrides => {
		expect(cleanTuningSamples([note(60, 12, overrides)])).toEqual([]);
	});

	it('drops extras, misses and rests', () => {
		expect(cleanTuningSamples([
			{ ...note(64, 22), extra: true },
			{ ...note(65, 22), missed: true, detected: null },
			{ ...note(67, 22), expected: { pitch: null, offset: [0, 1], duration: [1, 4] } }
		])).toEqual([]);
	});
});

describe('session tuning summary', () => {
	it('is empty before any clean note', () => {
		expect(summarizeTuning([])).toEqual({ notes: [], centre: null });
	});

	it('lists only the notes played, low to high, with each octave on its own', () => {
		const summary = summarizeTuning([...takes(74, [24]), ...takes(62, [3]), ...takes(67, [8])]);
		expect(summary.notes.map(n => n.midi)).toEqual([62, 67, 74]);
	});

	it('reads a note by its median and the middle half of its takes', () => {
		const [d] = summarizeTuning(takes(62, [2, 4, 6, 8, 30])).notes;
		expect(d).toEqual({ midi: 62, count: 5, median: 6, q1: 4, q3: 8, steady: true });
	});

	it(`calls a note steady from ${STEADY_TAKES} takes, and gives fewer no spread`, () => {
		const [few, steady] = summarizeTuning([...takes(60, [10, 14]), ...takes(62, [10, 12, 14])]).notes;
		expect(few).toEqual({ midi: 60, count: 2, median: 12, q1: null, q3: null, steady: false });
		expect(steady).toMatchObject({ count: 3, median: 12, steady: true });
	});

	it('centres on the steady notes, one vote each, so a much-played note cannot drag it', () => {
		const summary = summarizeTuning([
			...takes(60, [30], 40),
			...takes(62, [8], 3),
			...takes(64, [10], 3),
			...takes(65, [12], 3),
			...takes(67, [-40], 1)
		]);
		expect(summary.centre).toBe(11);
	});

	it(`has no centre until ${STEADY_TAKES} notes are steady`, () => {
		expect(summarizeTuning([...takes(60, [10], 3), ...takes(62, [10], 3), ...takes(64, [10], 2)]).centre)
			.toBeNull();
	});
});

describe('tuning summary lines', () => {
	/** Steady notes at the given offsets: C4, D4, E4, F4, G4. */
	const session = (...cents: number[]) =>
		summarizeTuning(cents.flatMap((c, i) => takes([60, 62, 64, 65, 67][i], [c], 3)));

	it.each([
		['tenor-sax', "You're 10¢ sharp overall. That's a mouthpiece adjustment, not a note problem."],
		['trumpet', "You're 10¢ sharp overall. That's a tuning-slide adjustment, not a note problem."],
		['concert', "You're 10¢ sharp overall. That's an overall tuning adjustment, not a note problem."]
	])('names an overall offset as the %s player would fix it', (instrumentId, line) => {
		expect(tuningSummaryLines(session(8, 10, 12), instrumentId, name)[0]).toBe(line);
	});

	it('says flat for a flat centre', () => {
		expect(tuningSummaryLines(session(-8, -10, -12), 'alto-sax', name)[0]).toMatch(/^You're 10¢ flat overall/);
	});

	it('names the note furthest from the centre', () => {
		expect(tuningSummaryLines(session(8, 10, 12, -11), 'tenor-sax', name)).toEqual([
			"You're 9¢ sharp overall. That's a mouthpiece adjustment, not a note problem.",
			'Against that, F4 sits 20¢ low.'
		]);
	});

	it('reports a centred, even scale', () => {
		expect(tuningSummaryLines(session(1, -2, 3, 0), 'tenor-sax', name)).toEqual([
			'Centred within 1¢ of A = 440.',
			'Every note sits within 5¢ of the rest.'
		]);
	});

	it('keeps a 5¢ centre in tune, the same zone the faders colour', () => {
		expect(tuningSummaryLines(session(4, 5, 6), 'tenor-sax', name)[0]).toBe('Centred within 5¢ of A = 440.');
	});

	it('asks for more phrases while too few notes are steady', () => {
		expect(tuningSummaryLines(summarizeTuning(takes(60, [12], 3)), 'tenor-sax', name)).toEqual([
			'A few more phrases will fill in the picture.'
		]);
		expect(tuningSummaryLines(summarizeTuning(takes(60, [12], 1)), 'tenor-sax', name)).toEqual([
			`Each note needs ${STEADY_TAKES} clean takes before it shows a tendency.`
		]);
	});
});
