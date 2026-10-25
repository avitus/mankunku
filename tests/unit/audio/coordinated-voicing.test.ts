import { describe, expect, it } from 'vitest';
import { resolveCoordinatedVoicing, coordinatedVoicingFamily, type CoordinatedVoicingFamily } from '$lib/audio/coordinated-voicing';
import { PITCH_CLASSES, type ChordQuality } from '$lib/types/music';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { shellVoicing, guideToneVoicing, drop2Voicing } from '$lib/audio/voicings';

describe('coordinated harmonic voice leading', () => {
	it('holds shared guide tones and moves the other voice by semitone through ii–V–I', () => {
		const d = resolveCoordinatedVoicing({ chord: { root: 'D', quality: 'min7' }, family: 'guide', registerMidi: 56 });
		expect(d.notes).toEqual([53, 60]);
		const g = resolveCoordinatedVoicing({ chord: { root: 'G', quality: '7' }, family: 'guide', registerMidi: 56, previous: d.memory });
		expect(g.notes).toEqual([53, 59]);
		const c = resolveCoordinatedVoicing({ chord: { root: 'C', quality: 'maj7' }, family: 'guide', registerMidi: 56, previous: g.memory });
		expect(c.notes).toEqual([52, 59]);
		expect(g.decision.guideMotion).toBe(1);
		expect(g.decision.commonTones).toEqual([53]);
	});
	it('distinguishes a dominant major third from its sharp ninth in coordinated guide and shell voicings', () => {
		for (const family of ['guide', 'shell'] as const) {
			const result = resolveCoordinatedVoicing({ chord: { root: 'C', quality: '7#9' }, family, registerMidi: 62 });
			expect(result.notes.map((note) => note % 12)).toContain(4);
			expect(result.notes.map((note) => note % 12)).toContain(10);
			expect(result.decision.correction).toBe('defining_tones');
		}
	});
	it('keeps the same semitone guide connections in all twelve ii–V–I keys', () => {
		for (let key = 0; key < 12; key++) {
			const d = resolveCoordinatedVoicing({ chord: { root: PITCH_CLASSES[(key + 2) % 12], quality: 'min7' }, family: 'guide', registerMidi: 56 + key });
			const g = resolveCoordinatedVoicing({ chord: { root: PITCH_CLASSES[(key + 7) % 12], quality: '7' }, family: 'guide', registerMidi: 56 + key, previous: d.memory });
			const c = resolveCoordinatedVoicing({ chord: { root: PITCH_CLASSES[key], quality: 'maj7' }, family: 'guide', registerMidi: 56 + key, previous: g.memory });
			expect(g.decision.guideMotion).toBe(1); expect(c.decision.guideMotion).toBe(1);
			expect(g.decision.commonTones).toHaveLength(1); expect(c.decision.commonTones).toHaveLength(1);
		}
	});
	it('repairs altered drop-2 identity without dropping the characteristic tension or changing global builders', () => {
		for (const [quality, color] of [['7b9', 1], ['7#9', 3], ['7#11', 6], ['7b13', 8]] as const) {
			const result = resolveCoordinatedVoicing({ chord: { root: 'C', quality }, family: 'drop2', registerMidi: 62 });
			expect(new Set(result.notes.map((note) => note % 12))).toEqual(new Set([0, 4, 10, color]));
			expect(result.decision.resolvedFamily).toBe('drop2');
			expect(result.decision.correction).toBe('defining_tones');
		}
		// These legacy builders deliberately remain unchanged outside the new path.
		expect(guideToneVoicing('C', '7#9').map((note) => note % 12)).toContain(3);
		expect(shellVoicing('C', '7#9').map((note) => note % 12)).not.toContain(4);
		expect(drop2Voicing('C', '7#9').map((note) => note % 12)).not.toContain(10);
	});
	it('keeps quartal fourth stacks exempt from defining-tone requirements and traces unsupported-family fallback', () => {
		const previous = resolveCoordinatedVoicing({ chord: { root: 'C', quality: 'maj7' }, family: 'guide', registerMidi: 62 }).memory;
		const quartal = resolveCoordinatedVoicing({ chord: { root: 'D', quality: 'min7' }, family: 'quartal', registerMidi: 62, previous });
		expect(quartal.notes.slice(1).map((note, index) => note - quartal.notes[index])).toEqual([5, 5, 5]);
		expect(quartal.decision.guideMotion).toBeNull();
		expect(quartal.decision.correction).toBe('none');
		const altered = resolveCoordinatedVoicing({ chord: { root: 'G', quality: '7alt' }, family: 'quartal', registerMidi: 62, previous: quartal.memory });
		expect(altered.decision.resolvedFamily).toBe('rootless-a');
		expect(altered.decision.correction).toBe('family_unavailable');
		const triad = resolveCoordinatedVoicing({ chord: { root: 'C', quality: 'dim' }, family: 'rootless-a', registerMidi: 62 });
		expect(triad.decision.resolvedFamily).toBe('shell');
		expect(new Set(triad.notes.map((note) => note % 12))).toEqual(new Set([0, 3, 6]));
	});
	it('retains repeated harmony exactly and only consumes the supplied actually-emitted memory', () => {
		const input = { chord: { root: 'D' as const, quality: 'min7' as const }, family: 'rootless-a' as const, registerMidi: 62 };
		const first = resolveCoordinatedVoicing(input);
		const before = JSON.stringify(first);
		const repeated = resolveCoordinatedVoicing({ ...input, registerMidi: 70, previous: first.memory });
		expect(repeated.notes).toEqual(first.notes);
		expect(repeated.decision.commonTones).toEqual(first.notes);
		resolveCoordinatedVoicing({ chord: { root: 'Ab', quality: '7b9' }, family: 'drop2', registerMidi: 72 });
		expect(resolveCoordinatedVoicing(input)).toEqual(first);
		expect(resolveCoordinatedVoicing({ ...input, previous: JSON.parse(JSON.stringify(first.memory)) })).toEqual(resolveCoordinatedVoicing({ ...input, previous: first.memory }));
		expect(JSON.stringify(first)).toBe(before);
		expect(Object.isFrozen(first.notes) && Object.isFrozen(first.memory.chord) && Object.isFrozen(first.decision.commonTones)).toBe(true);
	});
	it('keeps every supported quality, key and family legal and bounded, including diminished, suspended and triadic harmony', () => {
		const families: CoordinatedVoicingFamily[] = ['rootless-a', 'rootless-b', 'shell', 'drop2', 'quartal', 'guide'];
		for (const root of PITCH_CLASSES) for (const quality of Object.keys(CHORD_DEFINITIONS) as ChordQuality[]) for (const family of families) {
			const result = resolveCoordinatedVoicing({ chord: { root, quality }, family, registerMidi: 62 });
			expect(result.decision.candidateCount).toBeGreaterThan(0); expect(result.decision.candidateCount).toBeLessThanOrEqual(256);
			expect(result.notes.length).toBeGreaterThanOrEqual(2); expect(result.notes.length).toBeLessThanOrEqual(4);
			expect(result.notes.every((note, index) => Number.isInteger(note) && note >= 48 && note <= 84 && (index === 0 || note > result.notes[index - 1]))).toBe(true);
			expect(result.notes.at(-1)! - result.notes[0]).toBeLessThanOrEqual(24);
			if (result.decision.resolvedFamily !== 'quartal') {
				const intervals = CHORD_DEFINITIONS[quality].intervals;
				const third = intervals.includes(4) ? 4 : intervals.includes(3) ? 3 : intervals.includes(5) ? 5 : 2;
				const other = intervals.find((interval) => interval >= 9 && interval <= 11) ?? intervals.find((interval) => interval >= 6 && interval <= 8)!;
				for (const interval of [third, other]) expect(result.notes.map((note) => note % 12)).toContain((PITCH_CLASSES.indexOf(root) + interval) % 12);
			}
		}
	});
	it('bounds extreme requested registers and rejects malformed placement or memory', () => {
		const input = { chord: { root: 'C' as const, quality: 'maj7' as const }, family: 'shell' as const, registerMidi: 62 };
		for (const registerMidi of [0, 30, 95, 127]) expect(resolveCoordinatedVoicing({ ...input, registerMidi }).notes.every((note) => note >= 48 && note <= 84)).toBe(true);
		expect(() => resolveCoordinatedVoicing({ ...input, registerMidi: NaN })).toThrow('Invalid coordinated voicing input');
		expect(() => resolveCoordinatedVoicing({ ...input, previous: { version: 1, chord: input.chord, notes: [60, 60, 64] } })).toThrow('Invalid coordinated voicing memory');
	});
	it('maps existing builders without choosing a new family', () => {
		expect(coordinatedVoicingFamily(shellVoicing)).toBe('shell');
		expect(coordinatedVoicingFamily(guideToneVoicing)).toBe('guide');
		expect(coordinatedVoicingFamily(drop2Voicing)).toBe('drop2');
		expect(() => coordinatedVoicingFamily(() => [])).toThrow('Unknown coordinated voicing builder');
	});
});
