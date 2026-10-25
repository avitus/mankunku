import { expect, it, vi } from 'vitest';
import {
	embeddedSystemResult,
	mergeEmbeddedSystem,
	recognizeExtractedSystem
} from '$lib/tunes/import/pdf-embedded';
import type { ExtractedSystem } from '$lib/tunes/import/pdf-system-extract';
const bar = {
	startRepeat: false,
	endRepeat: false,
	ending: null,
	pickup: false,
	melody: [[0, 4, 'F#4']] as [number, number, string][]
};
const context = { clef: 'treble' as const, fifths: 2, timeSignature: [4, 4] as [number, number] };
const system = (bars: (typeof bar)[] | (typeof bar | null)[] = [bar]) =>
	({
		glyphs: {
			context,
			bars: bars.map(() => [{ x: 50, position: 1, head: 'whole', accidental: null }])
		},
		glyphBars: bars,
		geometry: { barlines: bars.map((_, i) => (i + 1) * 100) },
		texts: { chords: [{ x: 0, text: 'D7' }] }
	}) as ExtractedSystem;
it('reads complete embedded notation without consulting an optical provider', async () => {
	const optical = vi.fn();
	const r = await recognizeExtractedSystem(system(), context, optical);
	expect(r?.bars).toEqual([bar]);
	expect(optical).not.toHaveBeenCalled();
});
it('retains exact measures when an optical provider fails and marks missing slots', async () => {
	const r = await recognizeExtractedSystem(system([bar, null]), context, async () => {
		throw new Error('unavailable');
	});
	expect(r?.bars[0]).toEqual(bar);
	expect(r?.bars[1].melody).toEqual([]);
	expect(r?.warnings.join(' ')).toContain('bar 2');
});
it('does not align a wrong optical measure count by prefix', () => {
	const s = system([bar, null]);
	expect(() =>
		mergeEmbeddedSystem(
			s,
			{ bars: [bar], warnings: [], keySignature: null, timeSignature: null },
			context
		)
	).toThrow(/measure count/);
});
it('retains incomplete notation as reviewable slots without a provider', () => {
	expect(embeddedSystemResult(system([bar, null]))).toBeNull();
	expect(embeddedSystemResult(system([bar, null]), true)?.bars).toHaveLength(2);
});
it('reads harmony independently and retains melody if harmony fails', async () => {
	const s = system();
	s.texts.chords = [];
	const optical = vi.fn(async () => {
		throw new Error('no harmony');
	});
	const result = await recognizeExtractedSystem(s, context, optical);
	expect(optical).toHaveBeenCalledWith(true);
	expect(result?.bars).toEqual([bar]);
	expect(result?.warnings.join(' ')).toContain('Chord recognition failed');
});
it('fuses an optical read into the measures embedded notation could not read', async () => {
	const opticalBar = { ...bar, melody: [[0, 4, 'G4']] as [number, number, string][] };
	const r = await recognizeExtractedSystem(system([bar, null]), context, async () => ({
		bars: [opticalBar, opticalBar],
		warnings: ['bar 1: optical doubt', 'bar 2: optical doubt', 'whole system skewed'],
		keySignature: { fifths: 0 },
		clef: 'bass',
		timeSignature: [4, 4]
	}));
	// The embedded bar wins where it exists; optical fills only the gap.
	expect(r?.bars[0]).toBe(bar);
	expect(r?.bars[1].melody).toHaveLength(1);
	// A warning about a bar the embedded notation settled is moot; the rest stand.
	expect(r?.warnings).toEqual(['bar 2: optical doubt', 'whole system skewed']);
	// The embedded key and clef are exact; the optical guesses are not.
	expect(r?.keySignature).toEqual({ fifths: 2 });
	expect(r?.clef).toBe('treble');
});
it('rethrows an optical failure once the import was cancelled, rather than keep a partial read', async () => {
	const controller = new AbortController();
	controller.abort();
	const err = new Error('aborted');
	await expect(
		recognizeExtractedSystem(system([bar, null]), context, async () => {
			throw err;
		}, null, controller.signal)
	).rejects.toBe(err);
});
it('rethrows an optical failure when no embedded measure was read at all', async () => {
	await expect(
		recognizeExtractedSystem(system([null]), context, async () => {
			throw new Error('unavailable');
		})
	).rejects.toThrow('unavailable');
});
it('attaches independently read harmony to a complete embedded melody', async () => {
	const s = system();
	s.texts.chords = [];
	const harmony = [[[0, 'D7']]] as [number, string][][];
	const r = await recognizeExtractedSystem(s, context, async () => ({
		bars: [],
		harmony,
		warnings: ['bar 1: chord faint'],
		keySignature: null,
		clef: null,
		timeSignature: null
	}));
	expect(r?.harmony).toBe(harmony);
	expect(r?.bars).toEqual([bar]);
	expect(r?.warnings).toEqual(['bar 1: chord faint']);
});
it('flags harmony for review when no optical reader is configured', async () => {
	const s = system();
	s.texts.chords = [];
	const r = await recognizeExtractedSystem(s, context);
	expect(r?.bars).toEqual([bar]);
	expect(r?.warnings).toEqual(['Chord symbols need review; no optical reader is configured.']);
});
