import { describe, expect, it } from 'vitest';
import type { Tune, TuneSection } from '$lib/types/tune';
import { flattenTune } from '$lib/tunes/flatten';
import { formLoopRegion } from '$lib/tunes/form-loop';

/** A 4/4 tune from its sections. */
function tune(sections: TuneSection[]): Tune {
	return { id: 't', title: 'T', key: 'C', timeSignature: [4, 4], tags: [], source: 'user', sections };
}

const A: TuneSection = { label: 'A', bars: 8, notes: [{ pitch: 60, offset: [0, 1], duration: [1, 1] }], harmony: [] };
const B: TuneSection = { label: 'B', bars: 8, notes: [{ pitch: 62, offset: [0, 1], duration: [1, 1] }], harmony: [] };

/** The loop region of a tune's expanded (playback-order) timeline. */
function region(sheet: Tune) {
	return formLoopRegion(sheet, flattenTune(sheet, { expandRepeats: true }));
}

describe('formLoopRegion', () => {
	it('loops the whole form when the tune starts on the downbeat', () => {
		expect(region(tune([A, B]))).toEqual({ startBar: 0, endBar: 16 });
	});

	it('returns to the bar after a pickup-only section', () => {
		const pickup: TuneSection = {
			label: '', bars: 1, pickupLength: [1, 4], notes: [{ pitch: 67, offset: [3, 4], duration: [1, 4] }], harmony: []
		};
		expect(region(tune([pickup, A, B]))).toEqual({ startBar: 1, endBar: 17 });
	});

	// Legacy imports carry no pickupLength; the resolver infers it from the melody.
	it('returns to the bar after a legacy-import pickup', () => {
		const legacy: TuneSection = { label: '', bars: 1, notes: [{ pitch: 67, offset: [1, 2], duration: [1, 2] }], harmony: [] };
		expect(region(tune([legacy, A]))).toEqual({ startBar: 1, endBar: 9 });
	});

	it('returns to the bar after a pickup that opens a labelled section', () => {
		const opening: TuneSection = { ...A, bars: 9, pickupLength: [1, 2], notes: [{ pitch: 64, offset: [1, 2], duration: [1, 2] }] };
		expect(region(tune([opening, B]))).toEqual({ startBar: 1, endBar: 17 });
	});

	it('spans every expanded repeat', () => {
		expect(region(tune([{ ...A, repeatStart: true, repeatEnd: true }, B]))).toEqual({ startBar: 0, endBar: 24 });
	});
});
