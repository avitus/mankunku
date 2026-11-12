import { describe, expect, it } from 'vitest';
import { buildBarInfos, type BarInfo } from '$lib/audio/backing-generation';
import { planEnsemble } from '$lib/audio/ensemble-plan';
import { planDrumPhrases, planDrumPhraseBar, type DrumPhraseMemory } from '$lib/audio/backing-drum-phrases';
import type { BackingStyle } from '$lib/types/instruments';
import { createRollingBacking, advanceRollingBacking } from '$lib/audio/backing-rolling';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { BACKING_LAB_PRESETS } from '$lib/audio/backing-lab-presets';

function fixture(): BarInfo[] {
	const infos = buildBarInfos(32, [{ sourceSection: 0, barOffset: 0 }]);
	const plan = planEnsemble({ phraseId: 'texture-fixture', tempo: 140, bars: infos.map((info, barIndex) => ({ ...info, barIndex })) });
	return infos.map((info, barIndex) => ({ ...info, intensity: 0.8, ensemble: {
		...plan.bars[barIndex], energy: 0.8, intent: 'support', phraseIntent: 'support', responseOwner: 'nobody',
		coordinatedAccent: undefined, setupFor: undefined,
		performanceEnergy: { phase: barIndex < 4 ? 'head_in' : barIndex < 20 ? 'solo_peak' : barIndex < 28 ? 'solo_release' : 'ending', chorusIndex: 0, targetEnergy: 0.8 },
		drums: { role: 'time', keepTime: true, maxCommentaryHits: 0, commentaryScale: 0, allowFill: false }
	} }));
}
const input = (phraseId: string, style: BackingStyle = 'swing', bars = fixture()) => ({ phraseId, style, tempo: 140, beatsPerBar: 4, bars });
const quarterVoices = (bar: ReturnType<typeof planDrumPhrases>['bars'][number]) => bar.hits
	.filter((hit) => hit.role === 'timekeeping' && Number.isInteger(hit.beatOffset) && ['ride', 'ride-bell'].includes(hit.drum)).map((hit) => hit.drum);

describe.each(['swing', 'straight'] as const)('%s structural ride texture', (style) => {
	it('plays selected complete bell phrases at peaks, with a ride phrase between them and a ride return', () => {
		let bellPhrases = 0;
		for (let seed = 0; seed < 24; seed++) {
			const plan = planDrumPhrases(input(`bell-${seed}`, style));
			for (let start = 0; start < 32; start += 4) {
				const phrase = plan.bars.slice(start, start + 4);
				const bell = quarterVoices(phrase[0]).every((voice) => voice === 'ride-bell');
				if (bell) {
					bellPhrases++;
					expect(start).toBeGreaterThanOrEqual(4);
					expect(start).toBeLessThan(20);
					if (start > 0) expect(quarterVoices(plan.bars[start - 1])).toEqual(['ride', 'ride', 'ride', 'ride']);
				}
				for (const bar of phrase) {
					expect(quarterVoices(bar)).toEqual(Array(4).fill(bell ? 'ride-bell' : 'ride'));
					expect(bar.ride.voice).toBe(bell ? 'ride-bell' : 'ride');
					expect(bar.hits.filter((hit) => hit.drum === 'hihat-pedal').map((hit) => hit.beatOffset)).toEqual([1, 3]);
				}
			}
		}
		expect(bellPhrases).toBeGreaterThan(0);
		expect(bellPhrases).toBeLessThan(24 * 3);
	});
});

it('restores a selected texture exactly and accepts older ride-only checkpoints without upgrading mid-phrase', () => {
	const bars = fixture();
	let selected = false;
	for (let seed = 0; seed < 24 && !selected; seed++) {
		const phraseId = `restore-bell-${seed}`;
		const full = planDrumPhrases(input(phraseId, 'swing', bars));
		let memory: DrumPhraseMemory | undefined;
		for (let bar = 0; bar < bars.length; bar++) {
			const phraseStartBar = Math.floor(bar / 4) * 4;
			const stepInput = { phraseId, tempo: 140, beatsPerBar: 4 as const, barIndex: bar, info: bars[bar],
				phraseStartBar, phraseEndBarExclusive: phraseStartBar + 4, harmonyEndBeat: bars.length * 4,
				...(bar >= 4 && bar < 20 ? { peakEndBarExclusive: phraseStartBar + 4 } : {}) };
			const step = planDrumPhraseBar(stepInput, memory && JSON.parse(JSON.stringify(memory)));
			expect(step.bar).toEqual(full.bars[bar]);
			if (memory?.phrase.rideVoice === 'ride-bell' && bar < memory.phrase.end) {
				selected = true;
				expect(Object.isFrozen(step.memory.phrase)).toBe(true);
				const legacy = JSON.parse(JSON.stringify(memory));
				delete legacy.phrase.rideVoice;
				const old = planDrumPhraseBar(stepInput, legacy);
				expect(quarterVoices(old.bar)).toEqual(Array(4).fill('ride'));
				expect(old.bar.ride.voice).toBeUndefined();
				const invalid = JSON.parse(JSON.stringify(memory)); invalid.phrase.rideVoice = 'crash';
				expect(() => planDrumPhraseBar(stepInput, invalid)).toThrow('Invalid drum phrase checkpoint');
				expect(() => planDrumPhraseBar({ ...stepInput, peakEndBarExclusive: undefined }, memory)).toThrow('reserved bell phrase');
			}
			memory = step.memory;
		}
	}
	expect(selected).toBe(true);
});

it('skips one-bar peak opportunities, low energy and dense soloing rather than flashing an isolated bell', () => {
	for (let seed = 0; seed < 24; seed++) {
		for (const variant of ['one-bar', 'quiet', 'dense'] as const) {
			const bars = fixture().map((info, index) => ({ ...info, ensemble: { ...info.ensemble!,
				energy: variant === 'quiet' ? 0.6 : 0.8,
				performanceEnergy: { ...info.ensemble!.performanceEnergy!, phase: variant === 'one-bar' && index % 4 !== 0 ? 'solo_release' as const : info.ensemble!.performanceEnergy!.phase },
				drums: { ...info.ensemble!.drums, ...(variant === 'dense' ? { silenceReason: 'soloist_dense' as const } : {}) }
			} }));
			expect(planDrumPhrases(input(`skip-bell-${seed}`, 'swing', bars)).bars.every((bar) => quarterVoices(bar).every((voice) => voice === 'ride'))).toBe(true);
		}
	}
});

it('can realize a complete two-bar peak but never extends it into the release', () => {
	let selected = 0;
	const bars = fixture().slice(0, 2).map((info) => ({ ...info, ensemble: { ...info.ensemble!, performanceEnergy: {
		...info.ensemble!.performanceEnergy!, phase: 'solo_peak' as const
	} } }));
	for (let seed = 0; seed < 24; seed++) {
		const result = planDrumPhrases(input(`short-bell-${seed}`, 'straight', bars));
		if (result.bars[0].ride.voice === 'ride-bell') {
			selected++;
			expect(result.bars.every((bar) => bar.phraseLength === 2 && quarterVoices(bar).every((voice) => voice === 'ride-bell'))).toBe(true);
		}
	}
	expect(selected).toBeGreaterThan(0);
});

it('preserves legacy ride time and the native Bossa/Ballad grooves independently of peak metadata', () => {
	const bars = fixture();
	const legacy = bars.map((info) => { const { performanceEnergy: _arc, ...ensemble } = info.ensemble!; return { ...info, ensemble }; });
	for (const style of ['bossa-nova', 'ballad'] as const) {
		expect(planDrumPhrases(input('native-texture', style, bars))).toEqual(planDrumPhrases(input('native-texture', style, legacy)));
	}
	const plain = planDrumPhrases(input('legacy-texture', 'swing', legacy));
	expect(plain.bars.every((bar) => bar.ride.voice === undefined && quarterVoices(bar).every((voice) => voice === 'ride'))).toBe(true);
});

it('retains one right-hand stroke per onset when selected bell time meets commentary or an agreed arrival', () => {
	let selected = false;
	for (let seed = 0; seed < 24; seed++) {
		const bars = fixture().map((info, barIndex) => ({ ...info, ensemble: { ...info.ensemble!,
			...(barIndex % 4 === 1 ? { coordinatedAccent: { id: `arrival-${barIndex}`, targetBarIndex: barIndex, beatOffset: 0 as const, strength: 0.8, participants: ['bass', 'drums'] as const } } : {}),
			drums: { ...info.ensemble!.drums, maxCommentaryHits: 2 as const, commentaryScale: 1 }
		} }));
		const result = planDrumPhrases(input(`collision-bell-${seed}`, 'swing', bars));
		for (const bar of result.bars) {
			if (bar.ride.voice === 'ride-bell') selected = true;
			const hand = bar.hits.filter((hit) => ['ride', 'ride-bell', 'crash', 'hihat'].includes(hit.drum));
			expect(new Set(hand.map((hit) => hit.beatOffset)).size).toBe(hand.length);
			for (const beat of [0, 1, 2, 3]) expect(hand.some((hit) => hit.beatOffset === beat)).toBe(true);
			if (bar.barIndex % 4 === 1) expect(hand.filter((hit) => hit.beatOffset === 0).map((hit) => hit.drum)).toEqual(['crash']);
		}
	}
	expect(selected).toBe(true);
});

it('binds explicit rolling checkpoints to structural texture policy while preserving absent legacy ride state', () => {
	const preset = BACKING_LAB_PRESETS.find((entry) => entry.id === 'lab-aaba-c')!;
	const score = createRollingBacking(preset.phrase.harmony, BACKING_STYLES.swing, { phraseId: 'texture-binding',
		tempo: 140, ppq: 192, beatsPerBar: 4, swing: 0.67, performanceForm: preset.phrase.performanceForm, ensemble: {} });
	const first = advanceRollingBacking(score);
	const priorPolicy = score.fingerprint.replace(',"structuralTextureVersion":1', '');
	expect(priorPolicy).not.toBe(score.fingerprint);
	expect(() => advanceRollingBacking(score, { ...first.checkpoint, fingerprint: priorPolicy })).toThrow(/checkpoint/i);
	const copied = JSON.parse(JSON.stringify(first.checkpoint));
	expect(advanceRollingBacking(score, copied)).toEqual(advanceRollingBacking(score, first.checkpoint));
});

it('retains partial-harmony fallback rather than declaring a complete bell phrase', () => {
	const bars = fixture().slice(0, 2).map((info) => ({ ...info, ensemble: { ...info.ensemble!,
		performanceEnergy: { ...info.ensemble!.performanceEnergy!, phase: 'solo_peak' as const }
	} }));
	const plan = planDrumPhrases({ ...input('partial-peak', 'swing', bars), harmonyEndBeat: 6 });
	expect(plan.bars.every((bar) => bar.ride.voice === 'ride')).toBe(true);
	expect(plan.bars[1].hits.every((hit) => hit.beatOffset < 2)).toBe(true);
});
