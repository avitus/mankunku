import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { planDrumPhrases, planDrumPhraseBar, freezeDrumPhraseMemory, type DrumPhraseBarInput,
	type DrumPhraseMemory, type DrumPhraseDecision } from '$lib/audio/backing-drum-phrases';
import { planEnsemble } from '$lib/audio/ensemble-plan';
import { buildBarInfos, type BarInfo } from '$lib/audio/backing-generation';

function fixture(count = 24): BarInfo[] {
	const infos = buildBarInfos(count, [0, 3, 8, 16].filter((bar) => bar < count).map((barOffset, sourceSection) => ({ sourceSection, barOffset })));
	const ensemble = planEnsemble({ phraseId: 'drum-window', tempo: 160, bars: infos.map((bar, barIndex) => ({ ...bar, barIndex })) });
	return infos.map((info, index) => ({ ...info, ensemble: {
		...ensemble.bars[index], responseOwner: 'nobody', coordinatedAccent: undefined, setupFor: undefined,
		drums: { role: 'support', keepTime: true, maxCommentaryHits: 2, commentaryScale: 0.8, allowFill: false }
	} }));
}

function stepInput(bars: BarInfo[], barIndex: number, phraseId = 'drum-window-0', harmonyEndBeat = bars.length * 4): DrumPhraseBarInput {
	let start = 0;
	let end = 0;
	while (end <= barIndex) {
		start = end;
		end = start + 1;
		while (end < Math.min(bars.length, start + 4, Math.floor(harmonyEndBeat / 4)) &&
			bars[end].ensemble!.phraseStartBar === bars[start].ensemble!.phraseStartBar &&
			bars[end].sectionIndex === bars[start].sectionIndex && bars[end].chorusIndex === bars[start].chorusIndex) end++;
	}
	return { phraseId, tempo: 160, beatsPerBar: 4, barIndex, info: bars[barIndex],
		phraseStartBar: start, phraseEndBarExclusive: end, harmonyEndBeat,
		compOnsets: barIndex % 3 === 0 ? [] : [0.5, 2], bassOnsets: [0, 1, 2, 3] };
}

function runSteps(bars: BarInfo[], phraseId = 'drum-window-0', serialized = true): { bars: DrumPhraseDecision[]; memory: DrumPhraseMemory } {
	let memory: DrumPhraseMemory | undefined;
	const decisions: DrumPhraseDecision[] = [];
	for (let bar = 0; bar < bars.length; bar++) {
		const step = planDrumPhraseBar(stepInput(bars, bar, phraseId), memory);
		decisions.push(step.bar);
		memory = serialized ? JSON.parse(JSON.stringify(step.memory)) : step.memory;
	}
	return { bars: decisions, memory: memory! };
}

describe('drum phrase continuation', () => {
	it('preserves the pre-refactor complete performance fixture', () => {
		const bars = fixture();
		const traces = Array.from({ length: 8 }, (_, seed) => planDrumPhrases({
			phraseId: `drum-window-${seed}`, tempo: 160, beatsPerBar: 4, bars,
			compOnsetsByBar: new Map(bars.map((_, bar) => [bar, bar % 3 === 0 ? [] : [0.5, 2]])),
			bassOnsetsByBar: new Map(bars.map((_, bar) => [bar, [0, 1, 2, 3]]))
		}));
		const hash = createHash('sha256').update(JSON.stringify(traces)).digest('hex');
		// Captured from d349207b before extracting the resumable primitive.
		expect(hash).toBe('de7d432c13f1c8528c49ca7ab1c54f554ace41d297d881cca19176a9fd3b0770');
	});

	it('resumes every bar from JSON without restarting accepted ride or commentary phrases', () => {
		const bars = fixture();
		let developments = 0;
		let answers = 0;
		for (let seed = 0; seed < 8; seed++) {
			const phraseId = `drum-window-${seed}`;
			const expected = planDrumPhrases({ phraseId, tempo: 160, beatsPerBar: 4, bars,
				compOnsetsByBar: new Map(bars.map((_, bar) => [bar, stepInput(bars, bar).compOnsets!])),
				bassOnsetsByBar: new Map(bars.map((_, bar) => [bar, [0, 1, 2, 3]])) });
			const actual = runSteps(bars, phraseId);
			expect(actual.bars).toEqual(expected.bars);
			expect(actual).toEqual(runSteps(bars, phraseId, false));
			developments += actual.bars.filter((bar) => ['repeat', 'displace', 'orchestrate'].includes(bar.commentary.transform)).length;
			answers += actual.bars.filter((bar) => bar.commentary.transform === 'answer').length;
		}
		expect(developments).toBeGreaterThan(0);
		expect(answers).toBeGreaterThan(0);
	});

	it('withholds a later whole cell without replacing its already accepted source or ride reservation', () => {
		const bars = fixture();
		const baseline = runSteps(bars);
		const target = baseline.bars.find((bar) => bar.commentary.transform === 'displace' && bar.commentary.hits.length === 2)!;
		expect(target).toBeDefined();
		for (const change of ['silence', 'other_response', 'small_budget', 'setup', 'arrival'] as const) {
			const modified = bars.map((info, index): BarInfo => index === target.barIndex ? {
				...info, intensity: 0.9, ensemble: { ...info.ensemble!,
					responseOwner: change === 'other_response' ? 'piano' : 'nobody',
					coordinatedAccent: change === 'arrival' ? { id: 'window-arrival', targetBarIndex: index,
						beatOffset: 0, strength: 0.8, participants: ['bass', 'drums'] } : undefined,
					drums: { ...info.ensemble!.drums, maxCommentaryHits: change === 'silence' ? 0 : change === 'small_budget' ? 1 : 3,
						allowFill: change === 'setup' }
				}
			} : info);
			const actual = runSteps(modified);
			expect(actual.bars.slice(0, target.barIndex)).toEqual(baseline.bars.slice(0, target.barIndex));
			expect(actual.bars[target.barIndex].ride.mode).toBe(target.ride.mode);
			expect(actual.bars[target.barIndex].ride.skipOffsets).toEqual(target.ride.skipOffsets);
			if (change !== 'setup') expect(actual.bars[target.barIndex].commentary.hits).toEqual([]);
			const later = actual.bars[target.barIndex + 1];
			expect(later.commentary.motifId).toBe(target.commentary.motifId);
			expect(later.commentary.sourceBar).toBe(target.commentary.sourceBar);
		}
	});

	it('hears only the previous committed piano attacks, including a genuinely empty previous bar', () => {
		const bars = fixture();
		let answers = 0;
		for (let seed = 0; seed < 12; seed++) {
			let memory: DrumPhraseMemory | undefined;
			let silentMemory: DrumPhraseMemory | undefined;
			for (let index = 0; index < bars.length; index++) {
				const params = stepInput(bars, index, `piano-window-${seed}`);
				const current = index % 2 === 0 ? [0.5, 2] : [1, 2.5];
				const result = planDrumPhraseBar({ ...params, compOnsets: current }, memory);
				if (result.bar.commentary.transform === 'answer') {
					answers++;
					expect(result.bar.commentary.sourceBar).toBe(index - 1);
					expect(result.bar.commentary.sourceOffsets).toEqual(memory!.previousCompOnsets);
					expect(result.bar.commentary.sourceOffsets).not.toEqual(current);
				}
				memory = JSON.parse(JSON.stringify(result.memory));
				const silent = planDrumPhraseBar({ ...params, compOnsets: [] }, silentMemory);
				expect(silent.bar.commentary.source).not.toBe('piano');
				silentMemory = JSON.parse(JSON.stringify(silent.memory));
			}
		}
		expect(answers).toBeGreaterThan(0);
	});

	it('preserves current timing admission and partial final harmony across resumed bars', () => {
		const bars = fixture(4);
		const harmonyEndBeat = 12 + 5 / 3;
		const scheduledBeat = (beat: number) => beat % 1 === 0.5 ? Math.floor(beat) + 0.78 : beat;
		const acceptsOnset = (beat: number) => scheduledBeat(beat) < harmonyEndBeat;
		let memory: DrumPhraseMemory | undefined;
		const actual: DrumPhraseDecision[] = [];
		for (let index = 0; index < bars.length; index++) {
			const result = planDrumPhraseBar({ ...stepInput(bars, index, 'partial-drum-window', harmonyEndBeat), acceptsOnset }, memory);
			actual.push(result.bar);
			memory = JSON.parse(JSON.stringify(result.memory));
		}
		const full = planDrumPhrases({ phraseId: 'partial-drum-window', tempo: 160, beatsPerBar: 4, bars, harmonyEndBeat, acceptsOnset,
			compOnsetsByBar: new Map(bars.map((_, index) => [index, stepInput(bars, index).compOnsets!])),
			bassOnsetsByBar: new Map(bars.map((_, index) => [index, [0, 1, 2, 3]])) });
		expect(actual).toEqual(full.bars);
		for (const bar of actual) expect(bar.hits.every((hit) => acceptsOnset(bar.barIndex * 4 + hit.beatOffset))).toBe(true);
		expect(actual[3].ride.phase).toBe('single');
		expect(actual[3].hits.some((hit) => hit.drum === 'ride' && hit.beatOffset === 1.5)).toBe(false);
	});

	it('keeps finite deeply frozen bounded state without mutating input or restored checkpoints', () => {
		const bars = fixture(128);
		let memory: DrumPhraseMemory | undefined;
		const assertFrozen = (value: unknown): void => {
			if (!value || typeof value !== 'object') { if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true); return; }
			expect(Object.isFrozen(value)).toBe(true);
			for (const nested of Object.values(value)) assertFrozen(nested);
		};
		let acceptedSources = 0;
		for (let index = 0; index < bars.length; index++) {
			const params = stepInput(bars, index);
			const beforeInput = JSON.stringify(params);
			const beforeMemory = JSON.stringify(memory);
			const result = planDrumPhraseBar(params, memory);
			expect(JSON.stringify(params)).toBe(beforeInput);
			expect(JSON.stringify(memory)).toBe(beforeMemory);
			if (memory) expect(Object.isFrozen(memory)).toBe(false);
			assertFrozen(result);
			const restored = freezeDrumPhraseMemory(JSON.parse(JSON.stringify(result.memory)));
			assertFrozen(restored);
			expect(restored).toEqual(result.memory);
			expect(JSON.stringify(restored).length).toBeLessThan(2000);
			if (restored.phrase.motif) acceptedSources++;
			memory = JSON.parse(JSON.stringify(restored));
		}
		expect(acceptedSources).toBeGreaterThan(0);
	});

	it('rejects foreign, reordered, malformed or retargeted reservations before changing memory', () => {
		const bars = fixture();
		const first = planDrumPhraseBar(stepInput(bars, 0));
		const next = stepInput(bars, 1);
		for (const changes of [{ phraseId: 'foreign' }, { tempo: 180 }, { harmonyEndBeat: 100 },
			{ barIndex: 2, info: bars[2] }, { phraseEndBarExclusive: 2 }, { phraseStartBar: 1 },
			{ compOnsets: [NaN] }, { bassOnsets: Array(33).fill(0) }]) {
			expect(() => planDrumPhraseBar({ ...next, ...changes }, first.memory)).toThrow();
		}
		expect(() => planDrumPhraseBar(next)).toThrow(/zero/);
		expect(() => planDrumPhraseBar({ ...next, info: { ...next.info, sectionIndex: 9 } }, first.memory)).toThrow(/boundaries/);
		for (const changes of [{ version: 2 }, { nextBar: -1 }, { previousCompOnsets: [Infinity] },
			{ phrase: { ...first.memory.phrase, skips: [NaN] } }, { phrase: { ...first.memory.phrase, end: 1000 } }]) {
			const bad = { ...first.memory, ...changes } as DrumPhraseMemory;
			const before = JSON.stringify(bad);
			expect(() => planDrumPhraseBar(next, bad)).toThrow();
			expect(JSON.stringify(bad)).toBe(before);
		}
		let memory: DrumPhraseMemory | undefined;
		for (let index = 0; index < bars.length; index++) {
			const result = planDrumPhraseBar(stepInput(bars, index), memory);
			memory = result.memory;
			if (!memory.phrase.motif || index + 1 >= bars.length) continue;
			const bad = JSON.parse(JSON.stringify(memory)) as DrumPhraseMemory;
			Object.assign(bad.phrase.motif!, { sourceBar: index + 1 });
			expect(() => planDrumPhraseBar(stepInput(bars, index + 1), bad)).toThrow(/motif/);
			return;
		}
		throw new Error('Fixture must contain an accepted source');
	});
});
