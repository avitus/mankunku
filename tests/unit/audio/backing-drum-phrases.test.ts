import { describe, expect, it } from 'vitest';
import { planDrumPhrases, freezeDrumPhraseTrace, type DrumPhraseDecision } from '$lib/audio/backing-drum-phrases';
import { planEnsemble } from '$lib/audio/ensemble-plan';
import { buildBarInfos, generateDrums, type BarInfo } from '$lib/audio/backing-generation';
import { BACKING_STYLES, type DrumHitSpec } from '$lib/audio/backing-styles';

function fixture(count = 32): BarInfo[] {
	const infos = buildBarInfos(count, Array.from({ length: Math.ceil(count / 8) }, (_, index) => ({ sourceSection: index, barOffset: index * 8 })));
	const ensemble = planEnsemble({ phraseId: 'drum-phrases', tempo: 140, bars: infos.map((bar, barIndex) => ({ ...bar, barIndex })) });
	return infos.map((bar, index) => ({ ...bar, ensemble: {
		...ensemble.bars[index], responseOwner: 'nobody', coordinatedAccent: undefined, setupFor: undefined,
		drums: { role: 'support', keepTime: true, maxCommentaryHits: 2, commentaryScale: 1, allowFill: false }
	} }));
}

const input = (bars = fixture(), phraseId = 'drum-phrases') => ({ phraseId, tempo: 140, beatsPerBar: 4, bars });
const offsets = (entry: DrumPhraseDecision) => entry.commentary.hits.map((hit) => hit.beatOffset);
const limb = (hit: DrumHitSpec) => hit.drum === 'kick' ? 'RF' : hit.drum === 'hihat-pedal' ? 'LF'
	: ['snare', 'crossstick'].includes(hit.drum) ? 'LH' : 'RH';

function sourceOf(trace: readonly DrumPhraseDecision[], entry: DrumPhraseDecision): DrumPhraseDecision {
	return trace.find((candidate) => candidate.commentary.motifId === entry.commentary.motifId &&
		['statement', 'answer'].includes(candidate.commentary.transform))!;
}

describe('coordinated drum phrase planning', () => {
	it('keeps a recognizable ride cell through a phrase and preserves quarter time and the foot', () => {
		const plan = planDrumPhrases({ phraseId: 'drum-phrases', tempo: 140, beatsPerBar: 4, bars: fixture() });
		expect(plan.bars).toHaveLength(32);
		for (let start = 0; start < plan.bars.length; start += 4) {
			expect(plan.bars[start].ride.phase).toBe('statement');
			expect(plan.bars[start + 1].ride.phase).toBe('repeat');
			expect(plan.bars[start + 1].ride.skipOffsets).toEqual(plan.bars[start].ride.skipOffsets);
		}
		for (const bar of plan.bars) {
			for (const beat of [0, 1, 2, 3]) {
				expect(bar.hits.some((hit) => hit.beatOffset === beat && ['ride', 'ride-bell', 'crash'].includes(hit.drum))).toBe(true);
			}
			expect(bar.hits.filter((hit) => hit.drum === 'hihat-pedal').map((hit) => hit.beatOffset)).toEqual([1, 3]);
		}
	});

	it('develops selected complete cells with exact rhythmic displacement and a real timbral change', () => {
		const totals = { statement: 0, repeat: 0, displace: 0, orchestrate: 0, space: 0 };
		const sources = new Set<string>();
		let reverseCharlestons = 0;
		for (let seed = 0; seed < 12; seed++) {
			const plan = planDrumPhrases(input(fixture(), `drum-motifs-${seed}`));
			for (const entry of plan.trace) {
				const transform = entry.commentary.transform;
				if (transform in totals) totals[transform as keyof typeof totals]++;
				if (transform === 'statement') sources.add(entry.commentary.sourceId!);
				if (!['repeat', 'displace', 'orchestrate'].includes(transform)) continue;
				const source = sourceOf(plan.trace, entry);
				expect(source).toBeDefined();
				expect(entry.barIndex).toBeGreaterThan(source.barIndex);
				if (transform === 'displace') {
					expect(entry.commentary.displacementBeats).not.toBe(0);
					expect(offsets(entry)).toEqual(offsets(source).map((beat) => beat + entry.commentary.displacementBeats));
					if (source.commentary.sourceId === 'snare-charleston' && entry.commentary.displacementBeats === 0.5) {
						reverseCharlestons++;
						expect(offsets(source)).toEqual([0, 1.5]);
						expect(offsets(entry)).toEqual([0.5, 2]);
					}
				} else expect(offsets(entry)).toEqual(offsets(source));
				if (transform === 'orchestrate') {
					expect(entry.commentary.hits.map((hit) => hit.drum)).not.toEqual(source.commentary.hits.map((hit) => hit.drum));
				}
			}
		}
		for (const count of Object.values(totals)) expect(count).toBeGreaterThan(0);
		expect(totals.statement).toBeLessThan(12 * 8);
		expect(sources.has('snare-charleston')).toBe(true);
		expect(reverseCharlestons).toBeGreaterThan(0);
	});

	it('preserves a stated source while later ownership, silence, setup and budget decisions withhold whole cells', () => {
		const bars = fixture();
		const baseline = planDrumPhrases(input(bars));
		const target = baseline.trace.find((entry) => entry.commentary.transform === 'displace' && entry.commentary.hits.length === 2)!;
		expect(target).toBeDefined();
		for (const reason of ['ensemble_silence', 'response_reserved', 'arrival_reserved', 'gesture_does_not_fit', 'setup'] as const) {
			const changed = bars.map((bar, index): BarInfo => {
				if (index !== target.barIndex) return bar;
				const plan = bar.ensemble!;
				return { ...bar, ensemble: {
					...plan,
					responseOwner: reason === 'response_reserved' ? 'piano' : 'nobody',
					coordinatedAccent: reason === 'arrival_reserved' ? {
						id: 'arrival-test', targetBarIndex: index, beatOffset: 0, strength: 0.8, participants: ['bass', 'drums']
					} : undefined,
					drums: { ...plan.drums, maxCommentaryHits: reason === 'ensemble_silence' ? 0 : reason === 'gesture_does_not_fit' ? 1 : 3,
						allowFill: reason === 'setup' }
				} };
			});
			const actual = planDrumPhrases(input(changed));
			expect(actual.trace.slice(0, target.barIndex)).toEqual(baseline.trace.slice(0, target.barIndex));
			const cell = actual.trace[target.barIndex];
			if (reason === 'setup') {
				expect(cell.commentary.transform).toBe('setup');
				expect(cell.commentary.sourceId).toMatch(/^fill:/);
				expect(cell.commentary.motifId).toBeNull();
			} else {
				expect(cell.commentary).toMatchObject({ transform: 'space', reason, hits: [] });
				expect(cell.hits.filter((hit) => hit.role === 'commentary')).toEqual([]);
			}
			if (reason === 'arrival_reserved') {
				expect(cell.hits.filter((hit) => hit.role === 'accent').map((hit) => hit.drum)).toEqual(['crash', 'kick']);
				expect(cell.hits.filter((hit) => hit.beatOffset === 0 && limb(hit) === 'RH').map((hit) => hit.drum)).toEqual(['crash']);
			}
		}
	});

	it('does not label transforms until a source sounded and leaves intentional gaps empty even with coupling input', () => {
		const bars = fixture();
		const baseline = planDrumPhrases(input(bars));
		const source = baseline.trace.find((entry) => entry.commentary.transform === 'statement')!;
		const changed = bars.map((bar, index): BarInfo => index === source.barIndex ? {
			...bar, ensemble: { ...bar.ensemble!, drums: { ...bar.ensemble!.drums, maxCommentaryHits: 0 } }
		} : bar);
		const withheld = planDrumPhrases(input(changed));
		expect(withheld.trace[source.barIndex].commentary).toMatchObject({ motifId: null, source: 'none', transform: 'space' });
		for (const entry of withheld.trace) {
			if (['repeat', 'displace', 'orchestrate'].includes(entry.commentary.transform)) expect(sourceOf(withheld.trace, entry)).toBeDefined();
		}
		let gaps = 0;
		for (let seed = 0; seed < 8; seed++) {
			const plan = planDrumPhrases({ ...input(bars, `drum-gaps-${seed}`),
				compOnsetsByBar: new Map(bars.map((_, index) => [index, [0.5, 2.5]])),
				bassOnsetsByBar: new Map(bars.map((_, index) => [index, [0, 1, 2, 3, 3.5]])) });
			for (const entry of plan.trace.filter((entry) => entry.commentary.reason === 'motif_gap')) {
				gaps++;
				expect(entry.commentary.hits).toEqual([]);
				expect(entry.hits.every((hit) => hit.role === 'timekeeping')).toBe(true);
			}
		}
		expect(gaps).toBeGreaterThan(0);
	});

	it('answers only a previous emitted piano cell and cannot revise an earlier source from future piano data', () => {
		let answers = 0;
		for (let seed = 0; seed < 12; seed++) {
			const bars = fixture();
			const comp = new Map(bars.map((_, index) => [index, [0.5, 2]]));
			const params = { ...input(bars, `drum-answers-${seed}`), compOnsetsByBar: comp };
			const plan = planDrumPhrases(params);
			for (const entry of plan.trace.filter((entry) => entry.commentary.transform === 'answer')) {
				answers++;
				expect(entry.commentary.source).toBe('piano');
				expect(entry.commentary.sourceBar).toBe(entry.barIndex - 1);
				expect(entry.commentary.sourceId).toBe(`piano:${entry.barIndex - 1}`);
				expect(offsets(entry)).toEqual(comp.get(entry.barIndex - 1));
				const future = new Map(comp);
				for (let bar = entry.barIndex + 1; bar < bars.length; bar++) future.set(bar, [1.5, 3.5]);
				expect(planDrumPhrases({ ...params, compOnsetsByBar: future }).trace.slice(0, entry.barIndex + 1))
					.toEqual(plan.trace.slice(0, entry.barIndex + 1));
			}
		}
		expect(answers).toBeGreaterThan(0);
		expect(planDrumPhrases(input()).trace.some((entry) => entry.commentary.source === 'piano')).toBe(false);
	});

	it('applies the shared commentary dynamics without changing timekeeping or cell selection', () => {
		const bars = fixture();
		const baseline = planDrumPhrases(input(bars));
		const softer = planDrumPhrases(input(bars.map((bar) => ({
			...bar, ensemble: { ...bar.ensemble!, drums: { ...bar.ensemble!.drums, commentaryScale: 0.5 } }
		}))));
		let comments = 0;
		for (const [index, before] of baseline.trace.entries()) {
			const after = softer.trace[index];
			expect(after.commentary.transform).toBe(before.commentary.transform);
			expect(offsets(after)).toEqual(offsets(before));
			expect(after.hits.filter((hit) => hit.role === 'timekeeping')).toEqual(before.hits.filter((hit) => hit.role === 'timekeeping'));
			expect(after.commentary.hits.map((hit) => hit.velocity)).toEqual(before.commentary.hits.map((hit) => hit.velocity * 0.5));
			comments += before.commentary.hits.length;
		}
		expect(comments).toBeGreaterThan(0);
	});

	it('admits whole cells against final shared timing before freezing or claiming an audible source', () => {
		const params = input();
		const baseline = planDrumPhrases(params);
		const target = baseline.trace.find((entry) => entry.commentary.transform === 'displace' && entry.commentary.hits.length === 2)!;
		const lastOnset = target.barIndex * 4 + offsets(target).at(-1)!;
		const limited = planDrumPhrases({ ...params, acceptsOnset: (absBeat, hit) => hit.role !== 'commentary' || absBeat !== lastOnset });
		expect(limited.trace.slice(0, target.barIndex)).toEqual(baseline.trace.slice(0, target.barIndex));
		expect(limited.trace[target.barIndex].commentary).toMatchObject({ transform: 'space', reason: 'gesture_does_not_fit', hits: [] });
		expect(limited.trace[target.barIndex].hits.some((hit) => hit.role === 'commentary')).toBe(false);
		const source = sourceOf(baseline.trace, target);
		const sourceWithheld = planDrumPhrases({ ...params, acceptsOnset: (absBeat, hit) =>
			hit.role !== 'commentary' || Math.floor(absBeat / 4) !== source.barIndex });
		expect(sourceWithheld.trace[source.barIndex].commentary.motifId).toBeNull();
		for (const entry of sourceWithheld.trace) {
			if (['repeat', 'displace', 'orchestrate'].includes(entry.commentary.transform)) expect(sourceOf(sourceWithheld.trace, entry)).toBeDefined();
		}
		const end = 4 + 5 / 3;
		const swing = 0.78;
		const scheduledBeat = (beat: number) => beat % 1 === 0.5 ? Math.floor(beat) + swing : beat;
		const partial = planDrumPhrases({ ...input(fixture(2)), harmonyEndBeat: end,
			acceptsOnset: (absBeat) => scheduledBeat(absBeat) < end });
		expect(partial.trace[1].hits.some((hit) => hit.drum === 'ride' && hit.beatOffset === 1.5)).toBe(false);
		for (const entry of partial.trace) {
			expect(entry.hits.every((hit) => scheduledBeat(entry.barIndex * 4 + hit.beatOffset) < end)).toBe(true);
		}
	});

	it('resolves physical limbs before the trace and preserves every accepted hit through actual drum emission', () => {
		let substitutions = 0;
		for (let seed = 0; seed < 12; seed++) {
			const bars = fixture();
			const params = input(bars, `drum-limbs-${seed}`);
			const plan = planDrumPhrases(params);
			const events = generateDrums(4, BACKING_STYLES.swing, { ...params, ppq: 192, swing: 0.733 }, bars, new Map(), new Map(), plan.bars);
			for (const entry of plan.trace) {
				const slots = entry.hits.map((hit) => `${limb(hit)}:${hit.beatOffset}`);
				expect(new Set(slots).size).toBe(slots.length);
				const actual = events.filter((event) => Math.floor(event.absBeat / 4) === entry.barIndex);
				expect(actual.map(({ drum, absBeat, velocity, role }) => ({ drum, absBeat, velocity, role })))
					.toEqual(entry.hits.map(({ drum, beatOffset, velocity, role }) => ({ drum, absBeat: entry.barIndex * 4 + beatOffset, velocity, role })));
				substitutions += entry.commentary.hits.filter((hit) => hit.drum === 'ride-bell').length;
			}
		}
		expect(substitutions).toBeGreaterThan(0);
	});

	it('bounds ride and commentary phrases to short forms, section/chorus edges and actual partial endings', () => {
		for (const length of [1, 2, 3, 4]) {
			const plan = planDrumPhrases(input(fixture(length)));
			expect(plan.trace).toHaveLength(length);
			expect(plan.trace.every((entry) => entry.phraseStartBar === 0 && entry.phraseLength === length)).toBe(true);
			if (length === 1) expect(plan.trace[0].commentary).toMatchObject({ motifId: null, transform: 'fallback', reason: 'short_phrase' });
		}
		const bars = fixture(9).map((bar, index) => ({ ...bar, sectionIndex: index < 3 ? 0 : 1, chorusIndex: index < 6 ? 0 : 1 }));
		const bounded = planDrumPhrases(input(bars));
		for (const entry of bounded.trace) {
			const end = entry.phraseStartBar + entry.phraseLength;
			for (let bar = entry.phraseStartBar; bar < end; bar++) {
				expect(bars[bar].sectionIndex).toBe(bars[entry.barIndex].sectionIndex);
				expect(bars[bar].chorusIndex).toBe(bars[entry.barIndex].chorusIndex);
			}
		}
		for (const harmonyEndBeat of [0, 0.5, 2, 11.25, 14.5]) {
			const plan = planDrumPhrases({ ...input(fixture(4)), harmonyEndBeat });
			for (const entry of plan.trace) {
				expect(entry.hits.every((hit) => entry.barIndex * 4 + hit.beatOffset < harmonyEndBeat)).toBe(true);
				if (entry.commentary.motifId) expect((entry.phraseStartBar + entry.phraseLength) * 4).toBeLessThanOrEqual(harmonyEndBeat);
			}
		}
	});

	it('replays deeply frozen trace without mutating its inputs and rejects invalid timelines', () => {
		const params = input();
		const before = JSON.stringify(params);
		const plan = planDrumPhrases(params);
		expect(planDrumPhrases(params)).toEqual(plan);
		expect(JSON.stringify(params)).toBe(before);
		expect(Object.isFrozen(plan)).toBe(true);
		for (const trace of [plan.trace, freezeDrumPhraseTrace(JSON.parse(JSON.stringify(plan.trace)))]) {
			expect(trace).toEqual(plan.trace);
			expect(Object.isFrozen(trace)).toBe(true);
			for (const entry of trace) {
				for (const object of [entry, entry.ride, entry.ride.onsets, entry.ride.skipOffsets, entry.hits,
					entry.commentary, entry.commentary.sourceOffsets, entry.commentary.hits, ...entry.hits, ...entry.commentary.hits]) {
					expect(Object.isFrozen(object)).toBe(true);
				}
			}
		}
		expect(() => planDrumPhrases({ ...params, beatsPerBar: 3 })).toThrow(/four-beat/);
		expect(() => planDrumPhrases({ ...params, tempo: NaN })).toThrow(/tempo/);
		expect(() => planDrumPhrases({ ...params, bars: params.bars.slice(1) })).toThrow(/contiguous/);
		for (const harmonyEndBeat of [-1, Infinity, params.bars.length * 4 + 1]) {
			expect(() => planDrumPhrases({ ...params, harmonyEndBeat })).toThrow(/harmony extent/);
		}
	});
});
