import { describe, expect, it } from 'vitest';
import { tuneBackingStyle, cleanTuneBackingStyles } from '$lib/tunes/backing-style';
import type { Tune } from '$lib/types/tune';

const tune: Tune = { id: 'song', title: 'Song', key: 'C', timeSignature: [4, 4], tags: [], sections: [], source: 'user' };

describe('a tune’s backing style', () => {
	it.each([
		['Medium Swing', 'swing'], ['Bossa Nova', 'bossa-nova'], ['Slow ballad', 'ballad'],
		['Straight eighths', 'straight'], ['Rock', 'straight'], ['Unknown marking', 'swing']
	])('maps legacy chart marking %s to %s', (style, expected) => {
		expect(tuneBackingStyle({ ...tune, style })).toBe(expected);
	});
	it('prefers the saved style over the marking, and a personal override over the shared style', () => {
		const bossa = { ...tune, style: 'Swing', backingStyle: 'bossa-nova' as const };
		expect(tuneBackingStyle(bossa)).toBe('bossa-nova');
		expect(tuneBackingStyle(bossa, { song: 'ballad', another: 'straight' })).toBe('ballad');
	});
	it('discards corrupt values and inherited keys at the persistence boundary', () => {
		expect(cleanTuneBackingStyles({ song: 'bossa-nova', broken: 'funk' })).toEqual({ song: 'bossa-nova' });
		expect(cleanTuneBackingStyles(['swing'])).toEqual({});
		expect(tuneBackingStyle({ ...tune, id: 'constructor' })).toBe('swing');
	});
});
