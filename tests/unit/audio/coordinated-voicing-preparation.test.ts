import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { PITCH_CLASSES, type ChordQuality, type PitchClass } from '$lib/types/music';
import type { CoordinatedVoicingFamily, CoordinatedVoicingMemory } from '$lib/audio/coordinated-voicing';

vi.mock('$lib/audio/voicings', async importOriginal => {
	const actual = await importOriginal<typeof import('$lib/audio/voicings')>();
	return { ...actual, ...Object.fromEntries(['rootlessVoicingA', 'rootlessVoicingB', 'shellVoicing',
		'drop2Voicing', 'quartalVoicing', 'guideToneVoicing'].map(name => [name, vi.fn(actual[name as keyof typeof actual] as (...args: never[]) => unknown)])) };
});
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
const families: CoordinatedVoicingFamily[] = ['rootless-a', 'rootless-b', 'shell', 'drop2', 'quartal', 'guide'];
const chords: { root: PitchClass; quality: ChordQuality }[] = [
	{ root: 'F', quality: '7' }, { root: 'Bb', quality: '7' }, { root: 'G', quality: 'min7' },
	{ root: 'C', quality: 'maj7' }, { root: 'D', quality: 'min7b5' }, { root: 'C', quality: '7b9' }
];
async function load() {
	const solver = await import('$lib/audio/coordinated-voicing');
	const builders = await import('$lib/audio/voicings');
	return { ...solver, enumerations: () => [builders.rootlessVoicingA, builders.rootlessVoicingB, builders.shellVoicing,
		builders.drop2Voicing, builders.quartalVoicing, builders.guideToneVoicing].reduce((sum, fn) => sum + vi.mocked(fn).mock.calls.length, 0) };
}

describe('bounded chart-static voicing preparation', () => {
	it('prepares all family and eligible texture geometry without further enumeration during accepted history ranking', async () => {
		const solver = await load();
		solver.prepareCoordinatedVoicings([...chords, ...chords]);
		const prepared = solver.enumerations();
		expect(prepared).toBeGreaterThan(0);
		let previous: CoordinatedVoicingMemory | undefined;
		for (const chord of chords) for (const family of families) for (const rootlessTexture of ['two', 'three', 'full'] as const) {
			const resolved = solver.resolveCoordinatedVoicing({ chord, family, rootlessTexture, registerMidi: 62, previous,
				spacing: 'open', targetTopMidi: 72, keyboardContraryMotion: true });
			previous = resolved.memory;
		}
		expect(solver.enumerations()).toBe(prepared);
		solver.prepareCoordinatedVoicings(chords);
		expect(solver.enumerations()).toBe(prepared);
	});

	it('returns identical complete decisions and notes cold or prepared across actual prior voicings', async () => {
		const run = (solver: Awaited<ReturnType<typeof load>>) => {
			let previous: CoordinatedVoicingMemory | undefined;
			return chords.flatMap(chord => families.flatMap(family => (['two', 'three', 'full'] as const).map((rootlessTexture, index) => {
				const result = solver.resolveCoordinatedVoicing({ chord, family, rootlessTexture, previous,
					registerMidi: 56 + index * 5, spacing: index % 2 ? 'open' : 'compact', targetTopMidi: 69 + index,
					keyboardContraryMotion: true });
				previous = result.memory;
				return result;
			})));
		};
		const cold = run(await load());
		vi.resetModules();
		const warm = await load();
		warm.prepareCoordinatedVoicings(chords);
		expect(run(warm)).toEqual(cold);
	});

	it('caps preparation at a complete initial working set instead of evicting its own work on a large chart', async () => {
		const solver = await load();
		const large = PITCH_CLASSES.flatMap(root => (Object.keys(CHORD_DEFINITIONS) as ChordQuality[]).map(quality => ({ root, quality })));
		solver.prepareCoordinatedVoicings(large);
		const prepared = solver.enumerations();
		solver.prepareCoordinatedVoicings(large);
		expect(solver.enumerations(), 're-preparing the retained prefix must not enumerate and evict the entire chart again').toBe(prepared);
		solver.resolveCoordinatedVoicing({ chord: large[0], family: 'quartal', registerMidi: 62 });
		expect(solver.enumerations()).toBe(prepared);
		solver.resolveCoordinatedVoicing({ chord: large.at(-1)!, family: 'quartal', registerMidi: 62 });
		expect(solver.enumerations(), 'out-of-budget harmony still resolves through the ordinary lazy fallback').toBeGreaterThan(prepared);
	});

	it('retains no caller chord object and validates preparation harmony', async () => {
		const solver = await load();
		const chord = { root: 'F' as PitchClass, quality: '7' as ChordQuality };
		solver.prepareCoordinatedVoicings([chord]);
		chord.root = 'F#';
		const result = solver.resolveCoordinatedVoicing({ chord, family: 'rootless-a', registerMidi: 62 });
		expect(result.memory.chord.root).toBe('F#');
		expect(Object.isFrozen(chord)).toBe(false);
		expect(() => solver.prepareCoordinatedVoicings([{ root: 'bad' as PitchClass, quality: '7' }])).toThrow(/chord/i);
	});
});
