import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Phrase, PitchClass } from '$lib/types/music';
import type { Tune } from '$lib/types/tune';
import { saveUserLick } from '$lib/persistence/user-licks';
import { saveLickPracticeProgress } from '$lib/persistence/lick-practice-store';
import { settings } from '$lib/state/settings.svelte';
import { initTunePractice, resetTunePractice, previewSessionPlan, startTunePracticeSession,
	tunePractice, suggestionNameFor, expectedForSuggestion, candidatesForWindow } from '$lib/state/tune-practice.svelte';
import { fractionToFloat } from '$lib/music/intervals';
import { analyzeHarmony } from '$lib/tunes/harmonic-analysis';
import { flattenTune } from '$lib/tunes/flatten';
import { section, sheet, seg } from '../../helpers/tune-fixtures';
import { makePhrase } from '../../helpers/lick-builders';

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: {
	getItem: (key: string) => store.get(key) ?? null,
	setItem: (key: string, value: string) => store.set(key, value),
	removeItem: (key: string) => store.delete(key), clear: () => store.clear(),
	get length() { return store.size; }, key: (i: number) => [...store.keys()][i] ?? null
} });

const autumn = sheet(JSON.parse(readFileSync('tests/fixtures/leadsheets/autumn-in-new-york.json', 'utf8')));
const major: Phrase = { ...makePhrase({ id: 'my-three-bar-major', name: 'My Major Line', category: 'major-chord', harmony: [],
	notes: [{ pitch: 60, offset: [0, 1], duration: [1, 1] },
		{ pitch: 64, offset: [1, 1], duration: [1, 1] }, { pitch: 67, offset: [2, 1], duration: [1, 1] },
		{ pitch: null, offset: [3, 1], duration: [1, 1] }],
	difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 4 } }), mode: 'major' };

/** Mark the saved major line as playable in selected concert keys. */
function ready(keys: PitchClass[] = ['F']): void {
	saveLickPracticeProgress({ [major.id]: Object.fromEntries(keys.map(key => [key,
		{ passCount: 1, currentTempo: 240, lastPracticedAt: 1 }])) });
}

beforeEach(() => {
	store.clear(); resetTunePractice(); settings.instrumentId = 'tenor-sax';
	saveUserLick(major); ready(); initTunePractice(autumn);
	tunePractice.config.mode = 'suggest'; tunePractice.config.playHead = false;
	tunePractice.config.choruses = 1; tunePractice.config.tempo = 120;
});

describe('live major-region sessions', () => {
	it('Autumn in New York: preview, Start and scoring agree on bars 1–3, with bar 4 protected', () => {
		const before = structuredClone(autumn);
		const preview = previewSessionPlan(autumn, false, 1);
		const marker = preview.markers.find(m => m.startBar === 0)!;
		expect(marker).toMatchObject({ progressionType: 'major-region', timeRange: { start: 0, end: 3 },
			endBarExclusive: 3, label: 'My Major Line · G' });
		expect(preview.byType['major-region']).toBeGreaterThan(0);
		const audio = startTunePracticeSession(autumn, 480);
		const opening = tunePractice.plan.find(ip => ip.notationBarRange.start === 0)!;
		expect(opening).toMatchObject({ progressionType: 'major-region', bandName: 'Major region', keyCenter: 'F',
			notationTimeRange: { start: 0, end: 3 }, harmonicRegion: { key: 'F' } });
		expect(suggestionNameFor(opening)).toBe(marker.label);
		expect(opening.suggestions.map(s => s.lickId)).toEqual([major.id]);
		expect(opening.openTick).toBe(audio.countInBars * 4 * 480);
		expect(opening.closeTick).toBe((audio.countInBars + 3) * 4 * 480);
		const next = tunePractice.plan.find(ip => ip.notationBarRange.start === 3)!;
		expect(next.detectedType).not.toBe('major-region');
		expect(next.suggestions).toEqual([]); // No cornerstone lick: reservation still stands.
		expect(opening.closeTick).toBe(next.openTick);
		const finalCadence = tunePractice.plan.find(ip => ip.notationLabelBar === 31)!;
		expect(finalCadence.detectedType).not.toBe('major-region');
		expect(finalCadence.notationTimeRange).toEqual({ start: 31, end: 32 });
		expect(finalCadence.closeTick).toBe((audio.countInBars + 32) * 4 * 480);
		const expected = expectedForSuggestion(opening, opening.suggestions[0])!;
		expect(expected.phrase.key).toBe('F');
		expect(expected.phrase.notes.filter(n => n.pitch !== null).map(n => n.pitch! % 12)).toEqual([5, 9, 0]);
		expect(expected.phrase.notes.map(n => n.offset)).toEqual(major.notes.map(n => n.offset));
		expect(candidatesForWindow(opening, 'lick')[0]?.phrase).toEqual(expected.phrase);
		expect(audio.playedPhrase.harmony.slice(0, 8).map(h => h.chord))
			.toEqual(autumn.sections[0].harmony.slice(0, 8).map(h => h.chord));
		expect(autumn).toEqual(before);
	});

	it('preserves in-bounds progression windows when imported meter changes invalidate strict analysis', () => {
		// A 3/4 header retained on a chart whose later measures were imported in
		// 4/4: the closing harmony extends past the nominal four-bar form.
		const tune = sheet({ key: 'C', timeSignature: [3, 4], sections: [section({ bars: 4, harmony: [
			seg('D', 'min7', [0, 1], [3, 4]), seg('G', '7', [3, 4], [3, 4]),
			seg('C', 'maj7', [3, 2], [1, 1]), seg('Ab', '7', [5, 2], [1, 1]),
			seg('Bb', '7', [7, 2], [1, 1])
		] })] });
		const analysis = analyzeHarmony(flattenTune(tune), tune);
		expect(analysis.issues).toEqual(['invalid-timeline']);
		expect(analysis.majorRegions).toEqual([]);
		initTunePractice(tune); tunePractice.config.playHead = false;
		const preview = previewSessionPlan(tune, false);
		expect(preview.total).toBeGreaterThan(0);
		const audio = startTunePracticeSession(tune, 480);
		expect(tunePractice.plan[0].notationTimeRange.start).toBe(0);
		expect(tunePractice.plan.some(ip => ip.detectedType === 'major-region')).toBe(false);
		for (const ip of tunePractice.plan) {
			expect(ip.openTick).toBeLessThan(ip.closeTick);
			expect(ip.closeTick).toBeLessThanOrEqual((audio.countInBars + 4) * 3 * 480);
		}
	});

	it('keeps the bare major window and cornerstone reservation when the lick is not ready at tempo', () => {
		tunePractice.config.tempo = 250;
		startTunePracticeSession(autumn, 480);
		const opening = tunePractice.plan.find(ip => ip.notationBarRange.start === 0)!;
		expect(opening.suggestions).toEqual([]);
		expect(opening.notationTimeRange).toEqual({ start: 0, end: 3 });
		const reserved = analyzeHarmony(flattenTune(autumn), autumn, { reservationScope: 'form' }).reservedSegmentIndices;
		for (const ip of tunePractice.plan.filter(ip => ip.harmonicRegion)) {
			expect(ip.notationSegmentIndices.some(i => reserved.includes(i))).toBe(false);
		}
	});

	it('suggests the local center even when the tune declares another key', () => {
		const tune = { ...autumn, key: 'C' as const };
		initTunePractice(tune); tunePractice.config.playHead = false;
		const marker = previewSessionPlan(tune, false).markers.find(m => m.startBar === 0)!;
		expect(marker).toMatchObject({ label: 'My Major Line · G',
			harmonicRegion: { key: 'F', evidence: { matchesTuneKey: false } } });
	});

	it('transposes the same region and responds to the changed target-key readiness', () => {
		tunePractice.config.concertKey = 'Bb';
		expect(previewSessionPlan(autumn, false).markers.find(m => m.startBar === 0)?.lickName).toBeNull();
		ready(['F', 'Bb']);
		expect(previewSessionPlan(autumn, false).markers.find(m => m.startBar === 0)?.lickName).toBe('My Major Line · C');
	});

	it.each([true, false])('keeps marker provenance and scoring ticks over two choruses, head=%s', (playHead) => {
		tunePractice.config.playHead = playHead; tunePractice.config.choruses = 2;
		const audio = startTunePracticeSession(autumn, 480);
		const openings = tunePractice.plan.filter(ip => ip.notationBarRange.start === 0);
		expect(openings).toHaveLength(2);
		expect(openings.map(ip => ip.markerKey)).toEqual([openings[0].markerKey, openings[0].markerKey]);
		expect(openings[1].openTick - openings[0].openTick).toBe(32 * 4 * 480);
		expect(openings[0].openTick).toBe((audio.countInBars + (playHead ? 32 : 0)) * 4 * 480);
		for (const ip of openings) {
			expect(ip.closeTick - ip.openTick).toBe(3 * 4 * 480);
			expect(fractionToFloat(ip.suggestions[0].insertionOffset)).toBe(fractionToFloat(ip.startOffset));
			expect(expectedForSuggestion(ip, ip.suggestions[0])?.phrase.notes.map(n => n.offset)).toEqual(major.notes.map(n => n.offset));
		}
	});

	it('ends capture at the harmonic boundary even when a gap follows', () => {
		const tune = sheet({ key: 'F', sections: [section({ bars: 5,
			harmony: [...autumn.sections[0].harmony.slice(0, 6), seg('Ab', '7', [4, 1], [1, 1])] })] });
		initTunePractice(tune); tunePractice.config.playHead = false;
		const audio = startTunePracticeSession(tune, 480);
		const opening = tunePractice.plan.find(ip => ip.progressionType === 'major-region')!;
		expect(opening.notationTimeRange).toEqual({ start: 0, end: 3 });
		expect(opening.closeTick).toBe((audio.countInBars + 3) * 4 * 480);
	});

	it('keeps authored pickup offsets instead of moving the line before the major window', () => {
		saveUserLick({ ...major, notes: [{ pitch: 60, offset: [3, 4], duration: [1, 4] },
			{ pitch: 64, offset: [1, 1], duration: [2, 1] }], difficulty: { ...major.difficulty, pickupBars: 1 } });
		startTunePracticeSession(autumn, 480);
		const ip = tunePractice.plan.find(ip => ip.notationBarRange.start === 0)!;
		expect(expectedForSuggestion(ip, ip.suggestions[0])?.phrase.notes[0].offset).toEqual([3, 4]);
	});

	it('re-analyzes the closing chart and preserves the returning solo region', () => {
		const body = autumn.sections[0].harmony.slice(0, 6);
		const tune: Tune = sheet({ key: 'F', sections: [section({ label: 'A', bars: 3, repeatStart: true, harmony: body }),
			section({ label: 'Turnaround', bars: 1, ending: 1, repeatEnd: true, harmony: [seg('D', '7', [0, 1], [1, 1])] }),
			section({ label: 'Finish', bars: 1, ending: 2, harmony: [seg('F', 'maj7', [0, 1], [1, 1])] })] });
		initTunePractice(tune); tunePractice.config.playHead = false; tunePractice.config.choruses = 2;
		const audio = startTunePracticeSession(tune, 480);
		const regions = tunePractice.plan.filter(ip => ip.progressionType === 'major-region');
		expect(audio.separateClosingChart).toBe(true);
		expect(regions).toHaveLength(2);
		expect(regions.map(ip => !!ip.closingPass)).toEqual([false, true]);
		expect(regions.map(ip => ip.notationTimeRange)).toEqual([{ start: 0, end: 3 }, { start: 0, end: 4 }]);
		expect(regions.every(ip => ip.suggestions[0]?.lickId === major.id)).toBe(true);
	});
});
