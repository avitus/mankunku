import { describe, it, expect } from 'vitest';
import { fractionToFloat } from '$lib/music/intervals';
import { DEFAULT_BACKING_MIX } from '$lib/audio/backing-mix';
import {
	BACKING_LAB_PRESETS,
	LAB_TEMPO_PRESETS,
	buildChorusedForm,
	labPhraseWithSeed
} from '$lib/audio/backing-lab-presets';
import {
	eventTicksToSeconds,
	harmonyDurationBeats,
	bounceFilename,
	generateForBounce
} from '$lib/audio/backing-bounce';
import {
	LISTENING_CHECKLIST,
	buildListeningReport
} from '$lib/audio/backing-listening-checklist';
import { buildBarInfos } from '$lib/audio/backing-generation';

describe('backing lab presets', () => {
	it('every preset harmony tiles its bars exactly (no gaps, no overlaps)', () => {
		for (const preset of BACKING_LAB_PRESETS) {
			const segments = [...preset.phrase.harmony].sort(
				(a, b) => fractionToFloat(a.startOffset) - fractionToFloat(b.startOffset)
			);
			let cursor = 0;
			for (const seg of segments) {
				const start = fractionToFloat(seg.startOffset) * 4;
				const dur = fractionToFloat(seg.duration) * 4;
				expect(start, `${preset.id}: segment at beat ${start} leaves a gap/overlap`).toBeCloseTo(cursor, 6);
				expect(dur, `${preset.id}: non-positive duration`).toBeGreaterThan(0);
				cursor = start + dur;
			}
			expect(cursor, `${preset.id}: harmony extent ≠ declared bars`).toBeCloseTo(preset.bars * 4, 6);
		}
	});

	it('exposes the three protocol tempi', () => {
		expect([...LAB_TEMPO_PRESETS]).toEqual([90, 160, 240]);
	});

	it('AABA preset spans three choruses that buildBarInfos detects', () => {
		const aaba = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-aaba-c')!;
		expect(aaba.phrase.sectionMap).toBeDefined();
		const infos = buildBarInfos(aaba.bars, aaba.phrase.sectionMap);
		expect(infos[0].chorusIndex).toBe(0);
		expect(infos[32].chorusIndex).toBe(1);
		expect(infos[64].chorusIndex).toBe(2);
		// Section-final bars close each 8-bar section.
		expect(infos[7].isSectionFinalBar).toBe(true);
		expect(infos[8].isSectionFinalBar).toBe(false);
		expect(infos[95].isFinalBar).toBe(true);
	});

	it('buildChorusedForm shifts sections and restarts sourceSection per chorus', () => {
		const section = {
			harmony: [
				{
					chord: { root: 'C' as const, quality: 'maj7' as const },
					scaleId: 'major.ionian',
					startOffset: [0, 1] as [number, number],
					duration: [2, 1] as [number, number]
				}
			],
			bars: 2
		};
		const { harmony, sectionMap, bars } = buildChorusedForm([section, section], 2);
		expect(bars).toBe(8);
		expect(sectionMap).toEqual([
			{ sourceSection: 0, barOffset: 0 },
			{ sourceSection: 1, barOffset: 2 },
			{ sourceSection: 0, barOffset: 4 },
			{ sourceSection: 1, barOffset: 6 }
		]);
		expect(harmony.map((s) => fractionToFloat(s.startOffset))).toEqual([0, 2, 4, 6]);
	});

	it('labPhraseWithSeed suffixes the id only for positive integer seeds', () => {
		const preset = BACKING_LAB_PRESETS[0];
		expect(labPhraseWithSeed(preset, 0).id).toBe(preset.phrase.id);
		expect(labPhraseWithSeed(preset, 3).id).toBe(`${preset.phrase.id}#v3`);
	});

	it('seed changes the generated backing, seed 0 is canonical', () => {
		const preset = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-blues-f')!;
		const base = {
			style: 'swing' as const,
			tempo: 160,
			swing: 0.5,
			instrument: 'piano' as const,
			volume: 0.6,
			mix: DEFAULT_BACKING_MIX
		};
		const a = generateForBounce({ ...base, phrase: labPhraseWithSeed(preset, 0) });
		const b = generateForBounce({ ...base, phrase: labPhraseWithSeed(preset, 0) });
		const c = generateForBounce({ ...base, phrase: labPhraseWithSeed(preset, 1) });
		expect(a).toEqual(b);
		expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
	});
});

describe('bounce math', () => {
	it('converts event ticks to seconds', () => {
		// 192 ticks = one quarter at ppq 192; at 120 BPM that is 0.5 s.
		expect(eventTicksToSeconds('192i', 192, 120)).toBeCloseTo(0.5, 9);
		expect(eventTicksToSeconds('0i', 192, 120)).toBe(0);
		expect(eventTicksToSeconds('288i', 192, 60)).toBeCloseTo(1.5, 9);
	});

	it('computes harmony duration in beats', () => {
		const blues = BACKING_LAB_PRESETS.find((p) => p.id === 'lab-blues-f')!;
		expect(harmonyDurationBeats(blues.phrase)).toBe(48);
	});

	it('builds safe filenames', () => {
		const name = bounceFilename('lab-blues-f#v2', 'swing', 160);
		expect(name).toMatch(/^lab-blues-f_v2-swing-160bpm-\d{4}-\d{2}-\d{2}\.wav$/);
	});
});

describe('listening checklist', () => {
	it('has unique ids and non-empty prompts', () => {
		const ids = LISTENING_CHECKLIST.map((i) => i.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const item of LISTENING_CHECKLIST) {
			expect(item.prompt.length).toBeGreaterThan(0);
			expect(item.detail.length).toBeGreaterThan(0);
		}
	});

	it('renders a markdown report with verdict marks and notes', () => {
		const report = buildListeningReport(
			{ presetLabel: 'Blues', style: 'swing', tempo: 160, seed: 0, notes: 'ride too loud' },
			{ 'swing-medium-classic': 'pass', 'bass-contour': 'fail', 'mix-balance': 'skip' }
		);
		expect(report).toContain('### Listening report — Blues');
		expect(report).toContain('✅ At 160 BPM the swing is classic');
		expect(report).toContain('❌ The line goes somewhere');
		expect(report).toContain('➖ Balance sits right');
		expect(report).toContain('⬜');
		expect(report).toContain('ride too loud');
	});
});

describe('golden JSON rendering', () => {
	it('computes duration covering every event plus ring-out', async () => {
		const { eventsDurationSeconds } = await import('$lib/audio/backing-bounce');
		const generated = {
			bassEvents: [{ time: '384i', midi: 40, duration: 0.5, velocity: 80, absBeat: 2 }],
			compEvents: [],
			drumEvents: [{ time: '768i', drum: 'ride' as const, velocity: 0.4, absBeat: 4 }]
		};
		// At 120 BPM ppq 192: drum at 2s (+2 ring) dominates bass at 1s+0.5.
		expect(eventsDurationSeconds(generated, 120)).toBeCloseTo(4 + 2.5, 6);
	});

	it('rejects malformed golden JSON with readable messages', async () => {
		const { renderGoldenJsonToWav } = await import('$lib/audio/backing-bounce');
		await expect(renderGoldenJsonToWav({ nope: true }, {}, {
			instrument: 'piano',
			volume: 0.6,
			mix: DEFAULT_BACKING_MIX
		})).rejects.toThrow(/Not an events JSON/);
		await expect(renderGoldenJsonToWav(
			{ bassEvents: [], compEvents: [], drumEvents: [] },
			{},
			{ instrument: 'piano', volume: 0.6, mix: DEFAULT_BACKING_MIX }
		)).rejects.toThrow(/no usable tempo/);
		await expect(renderGoldenJsonToWav(
			{ bassEvents: [], compEvents: [], drumEvents: [], tempo: -60 },
			{},
			{ instrument: 'piano', volume: 0.6, mix: DEFAULT_BACKING_MIX }
		)).rejects.toThrow(/no usable tempo/);
	});
});
