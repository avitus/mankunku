import { describe, expect, it } from 'vitest';
import { resolveCoordinatedVoicing, type CoordinatedVoicingFamily } from '$lib/audio/coordinated-voicing';
import { PITCH_CLASSES, type ChordQuality } from '$lib/types/music';
import { CHORD_DEFINITIONS } from '$lib/music/chords';

const families: CoordinatedVoicingFamily[] = ['rootless-a', 'rootless-b', 'shell', 'drop2', 'quartal', 'guide'];
const withoutTexture = (result: ReturnType<typeof resolveCoordinatedVoicing>) => {
	const { rootlessTexture: _texture, ...decision } = result.decision;
	return { ...result, decision };
};

describe('three-note rootless voicing texture', () => {
	it('builds P20 defining/color tones in every key before legal placement', () => {
		for (const root of PITCH_CLASSES) for (const quality of ['maj7', 'min7', '7'] as const) {
			for (const family of ['rootless-a', 'rootless-b'] as const) {
				const result = resolveCoordinatedVoicing({ chord: { root, quality }, family, registerMidi: 62, rootlessTexture: 'three' });
				const third = quality === 'min7' ? 3 : 4;
				const seventh = quality === 'maj7' ? 11 : 10;
				const color = family === 'rootless-b' && quality === '7' ? 9 : 2;
				expect(result.notes.map((note) => (note - PITCH_CLASSES.indexOf(root) + 12) % 12).sort((a, b) => a - b))
					.toEqual([third, seventh, color].sort((a, b) => a - b));
				expect(result.notes).toHaveLength(3);
				expect(result.notes.every((note) => note >= 48 && note <= 84)).toBe(true);
				expect(result.decision.rootlessTexture).toEqual({ request: 'three', applied: 'three', eligible: true, noteCount: 3 });
				expect(Object.isFrozen(result.decision.rootlessTexture)).toBe(true);
			}
		}
	});

	it('keeps full requests byte-equivalent apart from the optional texture evidence', () => {
		for (const quality of Object.keys(CHORD_DEFINITIONS) as ChordQuality[]) for (const family of families) {
			const input = { chord: { root: 'C' as const, quality }, family, registerMidi: 62 };
			const old = resolveCoordinatedVoicing(input);
			const full = resolveCoordinatedVoicing({ ...input, rootlessTexture: 'full' });
			expect(withoutTexture(full)).toEqual(old);
			expect(full.decision.rootlessTexture?.applied).toBe('full');
			expect(full.decision.rootlessTexture?.noteCount).toBe(full.notes.length);
			expect(old.decision).not.toHaveProperty('rootlessTexture');
		}
	});

	it('preserves every unsupported family or chord, including fallback-to-rootless, with honest evidence', () => {
		for (const quality of Object.keys(CHORD_DEFINITIONS) as ChordQuality[]) for (const family of families) {
			if (['maj7', 'min7', '7'].includes(quality) && ['rootless-a', 'rootless-b'].includes(family)) continue;
			const input = { chord: { root: 'F#' as const, quality }, family, registerMidi: 62 };
			const old = resolveCoordinatedVoicing(input);
			const requested = resolveCoordinatedVoicing({ ...input, rootlessTexture: 'three' });
			expect(withoutTexture(requested)).toEqual(old);
			expect(requested.decision.rootlessTexture).toEqual({ request: 'three', applied: 'full', eligible: false, noteCount: old.notes.length });
		}
	});

	it('continues guide-tone motion through ii–V–I using the last emitted three-note chord', () => {
		const first = resolveCoordinatedVoicing({ chord: { root: 'D', quality: 'min7' }, family: 'rootless-a',
			registerMidi: 62, rootlessTexture: 'three' });
		const second = resolveCoordinatedVoicing({ chord: { root: 'G', quality: '7' }, family: 'rootless-b',
			registerMidi: 62, rootlessTexture: 'three', previous: first.memory });
		const third = resolveCoordinatedVoicing({ chord: { root: 'C', quality: 'maj7' }, family: 'rootless-a',
			registerMidi: 62, rootlessTexture: 'three', previous: second.memory });
		expect(second.decision.guideMotion).toBe(1);
		expect(third.decision.guideMotion).toBe(1);
		expect(second.decision.commonTones.length).toBeGreaterThan(0);
		expect(third.decision.commonTones.length).toBeGreaterThan(0);
		expect(resolveCoordinatedVoicing({ chord: { root: 'C', quality: 'maj7' }, family: 'rootless-a', registerMidi: 62,
			rootlessTexture: 'three', previous: JSON.parse(JSON.stringify(second.memory)) })).toEqual(third);
	});
});
