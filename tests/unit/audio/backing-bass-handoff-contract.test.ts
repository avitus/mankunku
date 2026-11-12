import { describe, expect, it } from 'vitest';
import { filterBassHandoffOptions } from '$lib/audio/backing-bass-handoff';

describe('bass approach handoff musical candidate contract', () => {
	it('keeps scale steps that can reach C7 chord tones before the unchanged D-flat approach', () => {
		// From C3 (48), these are the existing scale candidates. A2 and G2
		// can both reach E2 (40); the upper candidates cannot reach the approach.
		const options = Object.freeze([52, 45, 43, 50, 51]);
		const chordPcs = Object.freeze([0, 4, 7, 10]);
		expect(filterBassHandoffOptions(options, { beat: 1, approachMidi: 37, chordPcs })).toEqual([45, 43]);
		expect(options).toEqual([52, 45, 43, 50, 51]);
		expect(chordPcs).toEqual([0, 4, 7, 10]);
	});

	it('keeps the strong quarter on a chord tone close to the existing approach', () => {
		// D2 (38) is a scale tone, but not a structural C7 chord tone.
		// G2 (43) is a chord tone, but it cannot reach D-flat2 (37) within five.
		expect(filterBassHandoffOptions([36, 38, 40, 43, 46], {
			beat: 2, approachMidi: 37, chordPcs: [0, 4, 7, 10]
		})).toEqual([36, 40]);
	});

	it('does not invent a bridge across an unreachable register span', () => {
		expect(filterBassHandoffOptions([28, 30, 32], {
			beat: 1, approachMidi: 55, chordPcs: [0, 4, 7, 10]
		})).toEqual([]);
	});

	it('requires a distinct next pulse even when the repeated pitch would reach the approach', () => {
		expect(filterBassHandoffOptions([35, 36, 37], {
			beat: 1, approachMidi: 36, chordPcs: [0]
		})).toEqual([35, 37]);
	});

	it('retains safe ordered native candidates without adding pitches or changing the pool', () => {
		const options = Object.freeze([40, 36, 34]);
		expect(filterBassHandoffOptions(options, { beat: 2, approachMidi: 37, chordPcs: [0, 4, 7, 10] })).toEqual(options);
		expect(options).toEqual([40, 36, 34]);
	});
});
