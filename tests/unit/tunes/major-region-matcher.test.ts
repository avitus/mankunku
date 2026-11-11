import { describe, expect, it } from 'vitest';
import type { Phrase } from '$lib/types/music';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import { suggestLicksForMajorRegion, type LickMatcherDeps } from '$lib/tunes/lick-matcher';
import type { MajorRegion } from '$lib/tunes/harmonic-analysis';
import { majorRegionTargets } from '$lib/tunes/practice-target';
import { getAllLicks } from '$lib/phrases/library-loader';
import { makePhrase } from '../../helpers/lick-builders';

const region: MajorRegion = { key: 'F', mode: 'major', startOffset: [2, 1], duration: [3, 1],
	segmentIndices: [4, 5, 6], evidence: { tonicSegmentIndices: [6], cadences: [[5, 6]], matchesTuneKey: true } };

/** Create an ordinary major lick whose identity can be overridden per case. */
function line(overrides: Partial<Phrase> = {}): Phrase {
	return { ...makePhrase({ id: 'my-major', category: 'major-chord', harmony: [] }), ...overrides };
}

/** Supply deterministic book and progression-tag dependencies without stores. */
function deps(licks: Phrase[], tags: ChordProgressionType[] = []): LickMatcherDeps {
	return { licks, timeSignature: [4, 4], progress: {}, getProgressionTags: () => tags,
		getUnlockedKeyCount: () => 1, practiceLickIds: new Set() };
}

describe('major-region lick eligibility', () => {
	it('offers an ordinary major lick at the start, in the region key, without progression tags', () => {
		const suggestions = suggestLicksForMajorRegion(region, deps([line()])).suggestions;
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]).toMatchObject({ targetKey: 'F', mode: 'major', insertionOffset: [2, 1],
			insertionBar: 2, lengthBars: 1, matchSources: ['major-region'] });
	});

	it('accepts explicit major, major assignment, and actual tonic-major harmony, but not an inferred default', () => {
		const pool = [
			line({ id: 'explicit', category: 'user', mode: 'major' }),
			line({ id: 'assigned' }),
			line({ id: 'harmony', category: 'user', harmony: makePhrase().harmony }),
			line({ id: 'unclassified', category: 'user' }),
			line({ id: 'minor', mode: 'minor' })
		];
		expect(suggestLicksForMajorRegion(region, deps(pool)).suggestions.map(s => s.lickId).sort())
			.toEqual(['assigned', 'explicit', 'harmony']);
		expect(suggestLicksForMajorRegion(region, deps([line({ category: 'user' })], ['major-vamp'])).suggestions).toHaveLength(1);
	});

	it('does not treat dominant harmony as evidence for a major tonic', () => {
		const lick = line({ category: 'user', harmony: [{ chord: { root: 'C', quality: '7' },
			scaleId: 'major.mixolydian', startOffset: [0, 1], duration: [1, 1] }] });
		expect(suggestLicksForMajorRegion(region, deps([lick])).suggestions).toEqual([]);
	});

	it('retains cadence and changing-root fit requirements even for explicitly major lines', () => {
		const explicit = line({ mode: 'major' });
		expect(suggestLicksForMajorRegion(region, deps([{ ...explicit, category: 'ii-V-I-major' }])).suggestions).toEqual([]);
		expect(suggestLicksForMajorRegion(region, deps([explicit], ['ii-V-I-major-long'])).suggestions).toHaveLength(1);
		expect(suggestLicksForMajorRegion(region, deps([{ ...explicit, harmony: [{
			chord: { root: 'D', quality: 'min7' }, startOffset: [0, 1], duration: [1, 1], scaleId: 'major.dorian'
		}] }])).suggestions).toEqual([]);
	});

	it('allows a three-bar sounding line with four-bar padding, never a note extending into bar 4', () => {
		const padded = line({ notes: [{ pitch: 60, offset: [0, 1], duration: [3, 1] },
			{ pitch: null, offset: [3, 1], duration: [1, 1] }],
			difficulty: { ...line().difficulty, lengthBars: 4 } });
		expect(suggestLicksForMajorRegion(region, deps([padded])).suggestions[0]?.lengthBars).toBe(3);
		padded.notes[0].duration = [13, 4];
		expect(suggestLicksForMajorRegion(region, deps([padded])).suggestions).toEqual([]);
	});

	it('preserves pickup time and rejects silence-only or negative-entry phrases', () => {
		const pickup = line({ notes: [{ pitch: 60, offset: [3, 4], duration: [1, 4] },
			{ pitch: 64, offset: [1, 1], duration: [2, 1] }], difficulty: { ...line().difficulty, pickupBars: 1 } });
		expect(suggestLicksForMajorRegion(region, deps([pickup])).suggestions[0])
			.toMatchObject({ insertionOffset: region.startOffset, lengthBars: 3 });
		pickup.notes[1].duration = [9, 4];
		expect(suggestLicksForMajorRegion(region, deps([pickup])).suggestions).toEqual([]);
		for (const notes of [[{ pitch: null, offset: [0, 1], duration: [1, 1] }],
			[{ pitch: 60, offset: [-1, 4], duration: [1, 1] }]] as Phrase['notes'][]) {
			expect(suggestLicksForMajorRegion(region, deps([line({ notes })])).suggestions).toEqual([]);
		}
	});

	it('uses the actual meter and declines differently metered licks', () => {
		const waltz = line({ timeSignature: [3, 4], notes: [{ pitch: 60, offset: [0, 1], duration: [3, 4] }] });
		const waltzRegion = { ...region, duration: [3, 4] as [number, number] };
		expect(suggestLicksForMajorRegion(waltzRegion, deps([waltz])).suggestions).toEqual([]);
		const d = { ...deps([waltz]), timeSignature: [3, 4] as [number, number] };
		expect(suggestLicksForMajorRegion(waltzRegion, d).suggestions[0]?.lengthBars).toBe(1);
	});

	it('applies own-book, target-key mastery and target-key tempo filters', () => {
		const curated = getAllLicks()[0];
		const pool = [line(), line({ id: curated.id })];
		const d = deps(pool);
		const options = { ownBookOnly: true, playableKeysOnly: true, sessionTempo: 120 };
		expect(suggestLicksForMajorRegion(region, d, options).suggestions).toEqual([]);
		d.progress = { 'my-major': { C: { passCount: 1, currentTempo: 180, lastPracticedAt: 1 } } };
		expect(suggestLicksForMajorRegion(region, d, options).suggestions).toEqual([]);
		d.progress['my-major'].F = { passCount: 1, currentTempo: 100, lastPracticedAt: 1 };
		expect(suggestLicksForMajorRegion(region, d, options).suggestions).toEqual([]);
		d.progress['my-major'].F.currentTempo = 120;
		expect(suggestLicksForMajorRegion(region, d, options).suggestions.map(s => s.lickId)).toEqual(['my-major']);
	});
});

describe('region interpretation precedes lick selection', () => {
	it('leaves equally supported overlapping keys unassigned', () => {
		const a = { ...region, evidence: { ...region.evidence, cadences: [], matchesTuneKey: false } };
		const b = { ...a, key: 'C' as const };
		expect(majorRegionTargets([a, b], 'B')).toEqual([]);
		expect(majorRegionTargets([b, a], 'B')).toEqual([]);
	});

	it('prefers a cadence over song-key bias and keeps separate regions', () => {
		const other = { ...region, key: 'C' as const, evidence: { ...region.evidence, cadences: [], matchesTuneKey: true } };
		const cadential = { ...region, evidence: { ...region.evidence, matchesTuneKey: false } };
		expect(majorRegionTargets([other, cadential], 'C').map(t => t.localKey)).toEqual(['F']);
		expect(majorRegionTargets([other, { ...cadential, segmentIndices: [8, 9] }], 'C')).toHaveLength(2);
	});
});
