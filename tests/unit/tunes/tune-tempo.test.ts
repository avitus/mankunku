import { describe, expect, it } from 'vitest';
import { cleanTuneTempos, clampTuneTempo, savedTuneTempo } from '$lib/tunes/tune-tempo';

describe('a tune’s saved tempo', () => {
	it('clamps to the desk’s 40–240 BPM range and rounds', () => {
		expect(clampTuneTempo(30)).toBe(40);
		expect(clampTuneTempo(300)).toBe(240);
		expect(clampTuneTempo(132.6)).toBe(133);
		expect(clampTuneTempo(Number.NaN)).toBe(100);
	});
	it('discards corrupt values and inherited keys at the persistence boundary', () => {
		expect(cleanTuneTempos({ song: 180, slow: 20, broken: 'fast', nan: Number.NaN })).toEqual({ song: 180, slow: 40 });
		expect(cleanTuneTempos([120])).toEqual({});
		expect(cleanTuneTempos(null)).toEqual({});
		expect(savedTuneTempo({ song: 180 }, 'song')).toBe(180);
		expect(savedTuneTempo({ song: 180 }, 'other')).toBeUndefined();
		expect(savedTuneTempo({}, 'constructor')).toBeUndefined();
	});
});
