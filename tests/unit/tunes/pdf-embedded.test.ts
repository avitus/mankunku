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
