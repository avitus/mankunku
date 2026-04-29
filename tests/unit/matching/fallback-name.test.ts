import { describe, it, expect } from 'vitest';
import { fallbackName } from '$lib/matching/fallback-name';
import type { Note, Phrase, PhraseCategory } from '$lib/types/music';

function makePhrase(overrides: {
	category?: PhraseCategory;
	key?: Phrase['key'];
	notes: Note[];
	lengthBars?: number;
}): Phrase {
	return {
		id: 'test',
		name: 'test',
		timeSignature: [4, 4],
		key: overrides.key ?? 'C',
		notes: overrides.notes,
		harmony: [],
		difficulty: {
			level: 1,
			pitchComplexity: 1,
			rhythmComplexity: 1,
			lengthBars: overrides.lengthBars ?? 2
		},
		category: overrides.category ?? 'user',
		tags: [],
		source: 'user-entered'
	};
}

function eighths(pitches: Array<number | null>): Note[] {
	return pitches.map((pitch, i) => ({ pitch, duration: [1, 8], offset: [i, 8] }));
}

function quarters(pitches: Array<number | null>): Note[] {
	return pitches.map((pitch, i) => ({ pitch, duration: [1, 4], offset: [i, 4] }));
}

describe('fallbackName', () => {
	it('names a C-major scalar eighth line', () => {
		const phrase = makePhrase({
			category: 'ii-V-I-major',
			notes: eighths([60, 62, 64, 65, 67, 69, 71, 72]),
			lengthBars: 2
		});
		expect(fallbackName(phrase)).toBe('C ii-V-I (Maj) — scalar eighths, 2 bars');
	});

	it('names an arpeggiated quarter line', () => {
		const phrase = makePhrase({
			category: 'major-chord',
			notes: quarters([60, 64, 67, 72]),
			lengthBars: 1
		});
		// 1-bar arpeggio of C major triad: intervals = [4, 3, 5] — 2/3 arpeggio
		const result = fallbackName(phrase);
		expect(result).toContain('C Major Chord —');
		expect(result).toContain('arpeggio');
		expect(result).toContain('quarters');
		expect(result).toContain('1 bar');
		expect(result).not.toContain('1 bars');
	});

	it('detects chromatic movement', () => {
		const phrase = makePhrase({
			category: 'bebop-lines',
			notes: eighths([60, 61, 62, 63, 64, 65]),
			lengthBars: 1
		});
		const result = fallbackName(phrase);
		expect(result).toContain('chromatic');
	});

	it('tags wide leaps', () => {
		const phrase = makePhrase({
			category: 'user',
			notes: eighths([60, 72, 60, 72]),
			lengthBars: 1
		});
		const result = fallbackName(phrase);
		expect(result).toContain('wide');
		// 'user' category produces no progression
		expect(result.startsWith('C —')).toBe(true);
	});

	it('detects enclosures', () => {
		// Up-step, down-step, up-step, down-step pattern around target
		// 60, 62, 61, 63, 62 → intervals [+2, -1, +2, -1]: two enclosure pairs
		const phrase = makePhrase({
			category: 'enclosures',
			notes: eighths([60, 62, 61, 63, 62]),
			lengthBars: 1
		});
		const result = fallbackName(phrase);
		expect(result).toContain('enclosure');
	});

	it('calls out eighth triplets from note durations', () => {
		const phrase = makePhrase({
			category: 'user',
			notes: [
				{ pitch: 60, duration: [1, 12], offset: [0, 1] },
				{ pitch: 62, duration: [1, 12], offset: [1, 12] },
				{ pitch: 64, duration: [1, 12], offset: [2, 12] },
				{ pitch: 65, duration: [1, 12], offset: [3, 12] }
			],
			lengthBars: 1
		});
		const result = fallbackName(phrase);
		expect(result).toContain('eighth triplets');
	});

	it('produces singular "1 bar"', () => {
		const phrase = makePhrase({
			category: 'user',
			notes: quarters([60, 62]),
			lengthBars: 1
		});
		expect(fallbackName(phrase)).toContain('1 bar');
		expect(fallbackName(phrase)).not.toContain('1 bars');
	});

	it('falls back to "mixed rhythms" for heterogeneous durations', () => {
		const phrase = makePhrase({
			category: 'user',
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1] },
				{ pitch: 62, duration: [1, 8], offset: [1, 4] },
				{ pitch: 64, duration: [1, 2], offset: [3, 8] }
			],
			lengthBars: 1
		});
		expect(fallbackName(phrase)).toContain('mixed rhythms');
	});

	it('uses the phrase key in the output', () => {
		const phrase = makePhrase({
			key: 'F',
			category: 'blues',
			notes: eighths([65, 67, 68, 69]),
			lengthBars: 1
		});
		expect(fallbackName(phrase).startsWith('F Blues —')).toBe(true);
	});

	it('handles empty phrases gracefully', () => {
		const phrase = makePhrase({ category: 'user', notes: [], lengthBars: 1 });
		const result = fallbackName(phrase);
		expect(result).toContain('C');
		expect(result).toContain('mixed rhythms');
	});
});
