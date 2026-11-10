import { describe, expect, it } from 'vitest';
import { buildBarInfos, type BarInfo } from '$lib/audio/backing-generation';
import { planEnsemble } from '$lib/audio/ensemble-plan';
import { planDrumPhraseBar, freezeDrumPhraseTrace, type DrumPhraseBarInput, type DrumPhraseMemory } from '$lib/audio/backing-drum-phrases';
import type { BackingStyle } from '$lib/types/instruments';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { resolveBackingSwing } from '$lib/audio/backing-generation';
import { buildNativeBluesFixture } from '../../fixtures/musicality-native-blues';

function fixture(): BarInfo[] {
	const infos = buildBarInfos(16, [{ sourceSection: 0, barOffset: 0 }]);
	const plan = planEnsemble({ phraseId: 'cushion-fixture', tempo: 140, bars: infos.map((info, barIndex) => ({ ...info, barIndex })) });
	return infos.map((info, barIndex) => ({ ...info, intensity: .6, ensemble: {
		...plan.bars[barIndex], energy: .6, responseOwner: 'nobody', coordinatedAccent: undefined, setupFor: undefined,
		performanceEnergy: { phase: 'solo_release', chorusIndex: 0, targetEnergy: .6 },
		drums: { role: 'time', keepTime: true, maxCommentaryHits: 3, commentaryScale: .8, allowFill: false }
	} }));
}

function run(style: BackingStyle, seed: number, enabled = true, change?: (input: DrumPhraseBarInput) => DrumPhraseBarInput, replay = false) {
	let memory: DrumPhraseMemory | undefined;
	return fixture().map((info, barIndex) => {
		const input: DrumPhraseBarInput = { style, phraseId: `cushion-${seed}`, tempo: 140, beatsPerBar: 4,
			barIndex, info, phraseStartBar: Math.floor(barIndex / 4) * 4, phraseEndBarExclusive: Math.floor(barIndex / 4) * 4 + 4,
			harmonyEndBeat: 64, compOnsets: [2], compAttacks: [{ beatOffset: 2, durationBeats: 1, time: `${(barIndex * 4 + 2) * 192}i`, durationSeconds: 60 / 140 }],
			...(enabled ? { phraseCushioning: true } : {}) };
		const result = planDrumPhraseBar(change?.(input) ?? input, memory);
		memory = replay ? JSON.parse(JSON.stringify(result.memory)) : result.memory;
		return result.bar;
	});
}

describe.each(['swing', 'straight', 'bossa-nova', 'ballad'] as const)('%s phrase cushioning', style => {
	it('selectively eases accepted phrase releases with truthful changes and native pulse intact', () => {
		let changed = 0;
		for (let seed = 0; seed < 20; seed++) {
			const ordinary = run(style, seed, false), cushioned = run(style, seed);
			for (const [index, bar] of cushioned.entries()) {
				if (!bar.cushioning) { expect(bar).toEqual(ordinary[index]); continue; }
				changed++;
				expect(index % 4).toBe(3); expect(index).toBeLessThan(15);
				expect(bar.cushioning.compAttack).toMatchObject({ beatOffset: 2, durationBeats: 1 });
				expect(bar.cushioning.removedHits.length + bar.cushioning.softenedHits.length).toBeGreaterThan(0);
				for (const hit of bar.cushioning.removedHits) { expect(ordinary[index].hits).toContainEqual(hit); expect(bar.hits).not.toContainEqual(hit); }
				for (const hit of bar.cushioning.softenedHits) {
					expect(ordinary[index].hits).toContainEqual(hit.before); expect(bar.hits).toContainEqual(hit.after);
					expect(hit.after.velocity).toBeLessThan(hit.before.velocity);
					expect({ ...hit.after, velocity: hit.before.velocity }).toEqual(hit.before);
				}
				const pulse = (hits: typeof bar.hits) => hits.filter(hit => style === 'bossa-nova'
					? hit.drum !== 'hihat' || Number.isInteger(hit.beatOffset)
					: style === 'ballad' ? hit.drum !== 'ride' && hit.role !== 'commentary'
						: hit.role === 'timekeeping' && hit.drum !== 'ride' && hit.drum !== 'ride-bell');
				expect(pulse(bar.hits)).toEqual(pulse(ordinary[index].hits));
				if (style === 'bossa-nova' || style === 'ballad') expect(bar.hits.filter(hit => hit.role !== 'commentary').map(({ velocity, ...hit }) => hit))
					.toEqual(ordinary[index].hits.filter(hit => hit.role !== 'commentary').map(({ velocity, ...hit }) => hit));
				expect(bar.commentary.hits).toEqual(bar.hits.filter(hit => hit.role === 'commentary'));
			}
		}
		expect(changed).toBeGreaterThan(0); expect(changed).toBeLessThan(60);
	});

	it('preserves replies, fills, arrivals, dense restraint and absent real keyboard support', () => {
		const cases: ((input: DrumPhraseBarInput) => DrumPhraseBarInput)[] = [
			input => ({ ...input, compOnsets: [], compAttacks: [] }),
			input => ({ ...input, compAttacks: [{ ...input.compAttacks![0], durationBeats: .2, durationSeconds: .2 * 60 / input.tempo }] }),
			input => ({ ...input, info: { ...input.info, ensemble: { ...input.info.ensemble!, responseOwner: 'drums' } } }),
			input => ({ ...input, info: { ...input.info, ensemble: { ...input.info.ensemble!, responseOwner: 'piano' } } }),
			input => ({ ...input, info: { ...input.info, ensemble: { ...input.info.ensemble!, drums: { ...input.info.ensemble!.drums, allowFill: true } } } }),
			input => ({ ...input, info: { ...input.info, ensemble: { ...input.info.ensemble!, drums: { ...input.info.ensemble!.drums, silenceReason: 'soloist_dense' } } } }),
			...(['setupFor', 'coordinatedAccent'] as const).map(field => (input: DrumPhraseBarInput): DrumPhraseBarInput => ({ ...input,
				info: { ...input.info, ensemble: { ...input.info.ensemble!, [field]: { id: 'protected', targetBarIndex: input.barIndex,
					beatOffset: 0, strength: .5, participants: ['bass','piano','drums'] } } } }))
		];
		for (const change of cases) for (let seed = 0; seed < 4; seed++) expect(run(style, seed, true, change)).toEqual(run(style, seed, false, change));
	});

	it('leaves the omitted policy exact and rejects invented or malformed attack receipts', () => {
		expect(run(style, 2, false, input => ({ ...input, compAttacks: undefined }))).toEqual(run(style, 2, false));
		for (const changes of [{ beatOffset: 3 }, { durationBeats: NaN }, { durationSeconds: .001 }, { time: 'future' }]) {
			expect(() => run(style, 2, true, input => ({ ...input, compAttacks: [{ ...input.compAttacks![0], ...changes }] })))
				.toThrow(/accepted keyboard/);
		}
	});

	it('replays exactly after JSON checkpoints and deeply freezes new evidence', () => {
		for (let seed = 0; seed < 10; seed++) {
			const bars = run(style, seed);
			expect(run(style, seed, true, undefined, true)).toEqual(bars);
			for (const restored of [bars, freezeDrumPhraseTrace(JSON.parse(JSON.stringify(bars)))]) for (const bar of restored) {
				if (!bar.cushioning) continue;
				expect(Object.isFrozen(bar.cushioning)).toBe(true);
				expect(Object.isFrozen(bar.cushioning.compAttack)).toBe(true);
				expect(Object.isFrozen(bar.cushioning.removedHits)).toBe(true);
				for (const hit of bar.cushioning.softenedHits) { expect(Object.isFrozen(hit)).toBe(true); expect(Object.isFrozen(hit.before)).toBe(true); expect(Object.isFrozen(hit.after)).toBe(true); }
			}
		}
	});
});

it('has actual cushioning opportunities in full Blues performances, including native styles', () => {
	const phrase = buildNativeBluesFixture();
	for (const style of ['swing','straight','bossa-nova','ballad'] as const) {
		const witnessed: number[] = [];
		for (const seed of [42,7,19]) {
			const tempo = style === 'ballad' ? 80 : 140;
			const score = createRollingBacking(phrase.harmony, BACKING_STYLES[style], {
				phraseId: phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: resolveBackingSwing(.67, BACKING_STYLES[style], tempo),
				sectionMap: phrase.sectionMap, performanceForm: phrase.performanceForm, ensemble: {}
			}, { returningMelodySpace: true, performanceEnergySeed: seed, pianoPresence: 'accompaniment', keyboardVariety: 'developed',
				chorusBoundaryPriority: true, keyboardTexture: true, keyboardPhrasing: 'piano', drumPhraseCushioning: true });
			let checkpoint: RollingBackingCheckpoint | undefined;
			for (let index = 0; index < score.totalBars; index++) {
				const bar = advanceRollingBacking(score, checkpoint); checkpoint = bar.checkpoint;
				const trace = bar.ensembleDevelopment.drumPhrases?.[0];
				if (trace?.cushioning) {
					witnessed.push(index);
					expect(bar.compEvents.some(event => event.absBeat - index * 4 === trace.cushioning!.compAttack.beatOffset &&
						Math.abs(event.duration * tempo / 60 - trace.cushioning!.compAttack.durationBeats) < 1e-9)).toBe(true);
				}
			}
		}
		console.info('Full Blues cushioning', style, witnessed);
		expect.soft(witnessed.length, `${style} full performance cushioning`).toBeGreaterThan(0);
	}
});
