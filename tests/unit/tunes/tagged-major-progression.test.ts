import { describe, expect, it } from 'vitest';
import { makePhrase } from '../../helpers/lick-builders';
import { seg, section, sheet } from '../../helpers/tune-fixtures';
import { flattenTune } from '$lib/tunes/flatten';
import { analyzeHarmony } from '$lib/tunes/harmonic-analysis';
import { detectProgressions } from '$lib/tunes/progression-detector';
import { suggestLicksForProgression, type LickMatcherDeps } from '$lib/tunes/lick-matcher';
import { buildSessionPlan } from '$lib/state/tune-practice-plan';
import { practiceVocabulary } from '$lib/tunes/practice-vocabulary';
import type { Phrase } from '$lib/types/music';

const tune = sheet({ key: 'C', sections: [section({ bars: 4, harmony: [
	seg('D', 'min7', [0, 1], [1, 1]), seg('G', '7', [1, 1], [1, 1]),
	seg('C', 'maj7', [2, 1], [1, 1]), seg('A', '7', [3, 1], [1, 1])
] })] });
const flat = flattenTune(tune);
const cadence = detectProgressions(flat, tune).find(d => d.type === 'ii-V-I-major-long')!;
const major = makePhrase({ id: 'major-line', category: 'major-chord', mode: 'major',
	notes: [{ pitch: 60, offset: [0, 1], duration: [3, 1] }, { pitch: null, offset: [3, 1], duration: [1, 1] }],
	difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 4 } });

/** All keys unlocked, with explicit tags and independently controlled tempo readiness. */
function deps(licks: Phrase[] = [major]): LickMatcherDeps {
	return { licks, timeSignature: [4, 4], getProgressionTags: id => id.startsWith('major') ? ['ii-V-I-major-long'] : [],
		getUnlockedKeyCount: () => 12, practiceLickIds: new Set(), progress: Object.fromEntries(licks.map(l =>
			[l.id, { C: { passCount: 1, currentTempo: 140, lastPracticedAt: 1 } }])) };
}

/** Exercise matching and conflict selection together, optionally retaining setup alternatives. */
function plan(d: LickMatcherDeps, inventory = false) {
	return buildSessionPlan({ flat, notationFlat: flat, timeSignature: [4, 4], ppq: 480,
		includeAlternatives: inventory, detect: () => [cadence],
		match: detection => suggestLicksForProgression(detection, d,
			{ ownBookOnly: true, playableKeysOnly: true, sessionTempo: 120, includeUnready: inventory }),
		harmonicAnalysis: { key: 'C', analyze: () => ({ ...analyzeHarmony(flat, tune), progressions: [cadence] }),
			match: () => ({ suggestions: [], uncategorized: [] }) } });
}

describe('explicit major vocabulary over long ii–V–I', () => {
	it('starts at ii in the tonic key, using sounding duration rather than padded bars', () => {
		const suggestion = suggestLicksForProgression(cadence, deps()).suggestions[0];
		expect(suggestion).toMatchObject({ placement: 'progression', category: 'major-chord', targetKey: 'C',
			insertionOffset: [0, 1], templateAlignmentOffset: [0, 1], lengthBars: 3 });
		expect(plan(deps())[0]).toMatchObject({ progressionType: 'ii-V-I-major-long', startOffset: [0, 1], duration: [3, 1] });
	});

	it('leaves untagged Major licks on I and does not authorize a short cadence', () => {
		const d = deps([{ ...major, notes: makePhrase().notes, difficulty: makePhrase().difficulty }]);
		d.getProgressionTags = () => [];
		expect(suggestLicksForProgression(cadence, d).suggestions[0]).toMatchObject({ insertionOffset: [2, 1] });
		const shortTune = sheet({ sections: [section({ bars: 2, harmony: [
			seg('D', 'min7', [0, 1], [1, 2]), seg('G', '7', [1, 2], [1, 2]), seg('C', 'maj7', [1, 1], [1, 1])
		] })] });
		const short = detectProgressions(flattenTune(shortTune), shortTune).find(d => d.type === 'ii-V-I-major')!;
		expect(suggestLicksForProgression(short, deps()).suggestions.every(s => !s.placement)).toBe(true);
	});

	it.each([
		{ notes: [{ pitch: 60, offset: [0, 1], duration: [13, 4] }] },
		{ notes: [{ pitch: 60, offset: [-1, 4], duration: [1, 1] }] },
		{ notes: [{ pitch: null, offset: [0, 1], duration: [1, 1] }] },
		{ timeSignature: [3, 4] }
	] as Partial<Phrase>[])('declines overflowing, invalid, silent, or differently metered tagged lines: %j', overrides => {
		expect(suggestLicksForProgression(cadence, deps([{ ...major, ...overrides }])).suggestions).toEqual([]);
	});

	it('does not turn explicitly minor or changing-root lines into whole-cadence major uses', () => {
		for (const lick of [{ ...major, mode: 'minor' as const }, { ...major,
			harmony: [seg('D', 'min7', [0, 1], [1, 1]), seg('G', '7', [1, 1], [1, 1])] }]) {
			expect(suggestLicksForProgression(cadence, deps([lick])).suggestions.every(s => !s.placement)).toBe(true);
		}
	});

	it('keeps short tagged lines in one whole-cadence window, ending exactly at the boundary', () => {
		const short = { ...major, notes: makePhrase().notes };
		const point = plan(deps([short]))[0];
		expect(point.duration).toEqual([3, 1]);
		expect(point.closeTick - point.openTick).toBe(3 * 4 * 480);
	});

	it('keeps a pickup inside the cadence and preserves the authored onset', () => {
		const lick = { ...major, notes: [{ pitch: 60, offset: [3, 4] as [number, number], duration: [9, 4] as [number, number] }] };
		expect(suggestLicksForProgression(cadence, deps([lick])).suggestions[0]).toMatchObject({ insertionOffset: [0, 1], lengthBars: 3 });
	});

	it('prefers one tagged phrase, while inventory retains chord alternatives and unavailable full phrases', () => {
		const minor = makePhrase({ id: 'minor', category: 'minor-chord' });
		const dominant = makePhrase({ id: 'dominant', category: 'dominant-chord' });
		const slow = { ...major, id: 'major-slow', name: 'Slow major' };
		const native = makePhrase({ ...major, id: 'native-cadence', category: 'ii-V-I-major',
			harmony: flat.harmony.slice(0, 3), difficulty: { ...major.difficulty, lengthBars: 3 } });
		const d = deps([major, slow, minor, dominant, native]);
		d.progress[slow.id].C!.currentTempo = 80;
		d.progress[native.id].C!.currentTempo = 80;
		const scheduled = plan(d);
		expect(scheduled).toHaveLength(1);
		expect(scheduled[0].suggestions.map(s => s.lickId)).toEqual([major.id]);
		const inventory = practiceVocabulary(plan(d, true));
		expect(inventory.map(l => l.id).sort()).toEqual(['dominant', 'major-line', 'major-slow', 'minor', 'native-cadence']);
		expect(inventory.find(l => l.id === slow.id)).toMatchObject({ ready: false, placements: [
			expect.objectContaining({ context: 'Whole ii–V–I', keyReady: true, tempoReady: false, practicedTempo: 80 })
		] });
		d.progress[major.id].C!.currentTempo = 80;
		expect(plan(d).flatMap(p => p.suggestions.map(s => s.lickId))).toEqual(['minor', 'dominant']);
	});
});
