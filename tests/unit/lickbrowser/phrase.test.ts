import { describe, expect, it } from 'vitest';
import { chordQuality, parseChord, parseQuery, search } from '$lib/lickbrowser/search';
import { searchProgression } from '$lib/lickbrowser/progressions';
import { excerptPhrases } from '$lib/lickbrowser/phrase';
import { INSTRUMENTS } from '$lib/types/instruments';
import type { Solo } from '$lib/lickbrowser/types';

/** A solo of eighth notes over one chord a bar, with the given Weimar labels. */
function solo(labels: string[]): Solo {
	const ticks = Array.from({ length: labels.length * 8 }, (_, i) => i * 6);
	return {
		melid: 7,
		performer: 'Test',
		title: 'Changes',
		instrument: 'ts',
		avgtempo: 120,
		notes: ticks.map((t) => [t / 24, 0.25, 64]),
		metric: ticks.map((t) => [t, 6, 3, 6]),
		changes: [
			...labels.map((label, i): Solo['changes'][number] => [i * 2, i + 1, 1, label, i * 48]),
			[labels.length * 2, null, null, null, labels.length * 48]
		],
		bars: Array.from({ length: labels.length + 1 }, (_, i): [number, string, number] => [i * 48, '4/4', i + 1]),
		beats: Array.from({ length: labels.length * 4 + 1 }, (_, i) => i * 0.5)
	};
}

describe('lick browser phrase', () => {
	it('keys a turnaround that ends on its V by the progression tonic', () => {
		const [r] = searchProgression([solo(['Cj7', 'A7', 'D-7', 'G7'])], 'turnaround');
		const { score } = excerptPhrases(r, INSTRUMENTS['tenor-sax'], 68);
		expect(score.key).toBe('C');
		expect(score.mode).toBe('major');
	});

	it('keys a minor cadence as minor on its tonic', () => {
		const [r] = searchProgression([solo(['D-7b5', 'G79b', 'C-7'])], 'ii-V-I-minor-long');
		const { score } = excerptPhrases(r, INSTRUMENTS['tenor-sax'], 68);
		expect(score.key).toBe('C');
		expect(score.mode).toBe('minor');
	});

	it('keeps each chord’s own quality and slash bass in the structured harmony', () => {
		const [r] = search([solo(['D-7', 'G79b', 'C6/E'])], parseQuery('Dm7 G7 Cmaj7'));
		const { score } = excerptPhrases(r, INSTRUMENTS['tenor-sax'], 68);
		expect(score.harmony.map((h) => h.chord)).toEqual([
			{ root: 'D', quality: 'min7' },
			{ root: 'G', quality: '7b9' },
			{ root: 'C', quality: 'maj6', bass: 'E' }
		]);
	});

	it.each([
		['Cj7', 'maj7'],
		['Cj7911#', 'maj7'],
		['C', 'maj6'],
		['C69', 'maj6'],
		['C-', 'min7'],
		['C-6', 'min6'],
		['C-7b5', 'min7b5'],
		['Co', 'dim'],
		['Co7', 'dim7'],
		['C+', 'aug'],
		['C+7', 'aug7'],
		['Csus7', 'sus4'],
		['C7', '7'],
		['C7913', '7'],
		['C79b', '7b9'],
		['C79#', '7#9'],
		['C7911#', '7#11'],
		['C7913b', '7b13'],
		['C79b13b', '7alt'],
		['C7alt', '7alt'],
		['Cmaj7', 'maj7'],
		['Cm7', 'min7'],
		['G7b9', '7b9']
	])('reads %s as %s', (label, quality) => {
		expect(chordQuality(parseChord(label)!)).toBe(quality);
	});
});
