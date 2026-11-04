import { describe, it, expect } from 'vitest';
import type { Tune, TuneSection } from '$lib/types/tune';
import { flattenTune } from '$lib/tunes/flatten';
import { buildJamForm } from '$lib/tunes/jam-form';
import { soloPlaybackFlat } from '$lib/tunes/solo-form';
import { buildSessionPhrase, buildSessionPlan, headBarsForFlat, playbackBarForSessionBar } from '$lib/state/tune-practice-plan';
import { detectProgressions } from '$lib/tunes/progression-detector';
import { fractionToFloat } from '$lib/music/intervals';
import { editSectionLabel, sectionLabels } from '$lib/tunes/section-labels';
import { buildBarInfos } from '$lib/audio/backing-generation';

const section = (label: string, bars: number, pitch: number, extra: Partial<TuneSection> = {}): TuneSection => ({
	label, bars, notes: [{ pitch, offset: [0, 1], duration: [1, 1] }],
	harmony: [{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [bars, 1] }], ...extra
});
// Production Black Orpheus's closing repeat, with the printed marks restored.
const blackOrpheus: Tune = { id: 'black-orpheus', title: 'Black Orpheus', key: 'A', timeSignature: [4, 4], source: 'user', tags: [], sections: [
	section('', 1, 64, { pickupLength: [1, 4], notes: [{ pitch: 64, offset: [3, 4], duration: [1, 4] }], harmony: [] }),
	section('A', 16, 72), section('B', 16, 70),
	section('C', 3, 74, { repeatStart: true, omitFromSolos: true }),
	section('C', 1, 69, { ending: 1, repeatEnd: true, omitFromSolos: true }),
	section('C', 1, 69, { ending: 2, omitFromSolos: true }),
	section('', 1, 64, { notes: [], omitFromSolos: true })
] };

describe('explicit material omitted from solo choruses', () => {
	it('repairs the production Black Orpheus label layout without moving its closing repeat', () => {
		let imported: Tune = { ...blackOrpheus, sections: [
			section('A', 33, 72, { pickupLength: [1, 4], notes: [{ pitch: 64, offset: [3, 4], duration: [1, 4] }] }),
			section('B', 3, 74, { repeatStart: true }),
			section('B', 1, 69, { ending: 1, repeatEnd: true }),
			section('B', 1, 69, { ending: 2 }), section('C', 1, 64)
		] };
		imported = { ...imported, sections: editSectionLabel(imported, 1, 17)! };
		const c = sectionLabels(imported).find(m => m.label === 'C')!;
		imported = { ...imported, sections: editSectionLabel(imported, c.sectionIdx, 33)! };
		const start = sectionLabels(imported).find(m => m.label === 'C')!.sectionIdx;
		imported.sections.slice(start).forEach(s => { s.omitFromSolos = true; });
		expect(sectionLabels(imported).map(m => [m.label, m.bar])).toEqual([['A', 1], ['B', 17], ['C', 33]]);
		expect(buildJamForm(imported, 2).soloBars).toBe(32);
		expect(flattenTune(imported, { expandRepeats: true }).totalBars).toBe(42);
	});
	it('Black Orpheus solos play 32 bars of A+B, never the four-bar ending loop', () => {
		const jam = buildJamForm(blackOrpheus, 2);
		expect(jam.headBars).toBe(42); // pickup + A+B + repeated C and final bar
		expect(jam.soloBars).toBe(32);
		expect(jam.outroStartBar).toBe(106);
		expect(jam.phraseBars).toBe(147); // closing melody includes C, skips pickup
		expect(jam.sessionBarMap?.slice(42, 74)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
		expect(jam.sessionBarMap?.slice(74, 106)).toEqual(jam.sessionBarMap?.slice(42, 74));
		expect(jam.notes.filter(n => { const t = fractionToFloat(n.offset); return t >= 42 && t < 106; })).toEqual([]);
		expect(jam.notes.map(n => n.pitch)).toContain(74); // C still sounds in both heads
		expect(playbackBarForSessionBar(58.5, jam.flat.totalBars, jam.headBars, jam.practiceStartBar, jam.closingStartBar, jam.outroSourceStartBar, jam.sessionBarMap)).toBe(17.5);
		expect(headBarsForFlat(jam.flat).formRepeats).toBe(false);
		const plan = buildSessionPlan({ flat: jam.flat, notationFlat: flattenTune(blackOrpheus), timeSignature: [4, 4], ppq: 192,
			pickupBars: 1, countInBars: 1, choruses: 2, head: { bars: 42, mode: 'shift' },
			detect: f => detectProgressions(f, blackOrpheus), match: () => ({ suggestions: [], uncategorized: [] }) });
		expect(plan.length).toBeGreaterThan(0);
		expect(plan.every(p => p.notationBarRange.start >= 1 && p.notationBarRange.endExclusive <= 33)).toBe(true);
		expect(Math.min(...plan.map(p => p.openTick))).toBe(43 * 4 * 192);
		expect(Math.max(...plan.map(p => p.closeTick))).toBeLessThanOrEqual(107 * 4 * 192);
	});
	it('skips an interior section while retaining original note/chord and bar provenance', () => {
		const tune: Tune = { ...blackOrpheus, sections: [section('A', 4, 60), section('B', 4, 62, { omitFromSolos: true }), section('C', 4, 64)] };
		const original = flattenTune(tune, { expandRepeats: true });
		const solo = soloPlaybackFlat(original, [4, 4], 0);
		expect(solo.flat.totalBars).toBe(8);
		expect(solo.flat.segmentSourceIndices).toEqual([0, 2]);
		expect(solo.sourceBars).toEqual([0, 1, 2, 3, 8, 9, 10, 11]);
		const session = buildSessionPhrase({ flat: original, timeSignature: [4, 4], playHead: false, playOutro: true, choruses: 2 });
		expect(session.phraseBars).toBe(16);
		expect(session.notes).toEqual([]);
		expect(session.closingStartBar).toBeNull();
		expect(session.sessionBarMap).toEqual([...solo.sourceBars, ...solo.sourceBars]);
	});
	it('does not create silent solo bars when every section is omitted', () => {
		const tune: Tune = { ...blackOrpheus, sections: [section('A', 4, 60, { omitFromSolos: true })] };
		const jam = buildJamForm(tune, 3);
		expect(jam.phraseBars).toBe(4);
		expect(jam.outroStartBar).toBeNull();
	});
	it('starts the rhythm section at bar zero after stripping an embedded pickup', () => {
		const tune: Tune = { ...blackOrpheus, sections: [
			section('A', 5, 60, { pickupLength: [1, 4], notes: [{ pitch: 60, offset: [3, 4], duration: [1, 4] }] }),
			section('C', 4, 64, { omitFromSolos: true })
		] };
		const solo = soloPlaybackFlat(flattenTune(tune), [4, 4], 1);
		expect(solo.flat.sectionMap[0].barOffset).toBe(0);
		expect(buildBarInfos(solo.flat.totalBars, solo.flat.sectionMap)[0].isSectionFirstBar).toBe(true);
		expect(solo.sourceBars).toEqual([1, 2, 3, 4]);
	});
});
