import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendPitchPanels, measureSourceLeft } from '$lib/tunes/import/pdf-review-image';
import type { SystemGeometry } from '$lib/tunes/import/pdf-geometry';
import type { NoteEvent } from '$lib/tunes/import/pdf-noteheads';
const geometry: SystemGeometry = {
	band: { top: 100, bottom: 180, lines: [100, 120, 140, 160, 180] },
	interline: 20,
	firstBarLeft: 100,
	barlines: [300],
	repeatDots: []
};
const notes: NoteEvent[] = [
	{ x: 110, anchorX: 122, position: 1, kind: 'stemmed' },
	{ x: 290, anchorX: 278, position: 7, kind: 'stemmed' }
];
const source = { width: 800, height: 600 } as HTMLCanvasElement;
const measure = { width: 248, height: 200 } as HTMLCanvasElement;
function canvasMock() {
	const context = {
		drawImage: vi.fn(),
		fillRect: vi.fn(),
		fillText: vi.fn(),
		save: vi.fn(),
		restore: vi.fn(),
		translate: vi.fn(),
		scale: vi.fn()
	};
	const output = { getContext: () => context, width: 0, height: 0 };
	vi.stubGlobal('document', { createElement: vi.fn(() => output) });
	return { context, output };
}
afterEach(() => vi.unstubAllGlobals());
describe('pitch review source panels', () => {
	it('retains the whole measure and clips enlarged columns to its boundaries', () => {
		const { context, output } = canvasMock();
		expect(appendPitchPanels(source, measure, geometry, notes, 100, 300)).toBe(output);
		expect(context.drawImage.mock.calls[0]).toEqual([measure, 0, 0]);
		for (const call of context.drawImage.mock.calls.slice(1)) {
			expect(call[0]).toBe(source);
			expect(call[1]).toBeGreaterThanOrEqual(100);
			expect(call[1] + call[3]).toBeLessThanOrEqual(300);
		}
		expect(output.height).toBeGreaterThan(measure.height);
	});
	it('isolates the head column from nearby flags while retaining all vertical staff context', () => {
		const { context } = canvasMock();
		appendPitchPanels(source, measure, geometry, notes, 100, 300);
		for (const call of context.drawImage.mock.calls.slice(1)) {
			expect(call[3]).toBeLessThanOrEqual(geometry.interline);
			expect(call[4]).toBe(8 * geometry.interline);
		}
	});
	it('excludes the measured stem on either side of an isolated head', () => {
		const { context } = canvasMock();
		const closeStems = [
			{ ...notes[0], anchorX: 118 },
			{ ...notes[1], anchorX: 282 }
		];
		appendPitchPanels(source, measure, geometry, [closeStems[0]], 100, 300);
		const first = context.drawImage.mock.calls[1];
		context.drawImage.mockClear();
		appendPitchPanels(source, measure, geometry, [closeStems[1]], 100, 300);
		const second = context.drawImage.mock.calls[1];
		expect(first[1] + first[3]).toBeLessThanOrEqual(
			closeStems[0].anchorX - 0.15 * geometry.interline
		);
		expect(second[1]).toBeGreaterThanOrEqual(closeStems[1].anchorX + 0.15 * geometry.interline);
	});
	it('retains head-centered columns for multiple notes where stem exclusion reduced accuracy', () => {
		const { context } = canvasMock();
		appendPitchPanels(source, measure, geometry, notes, 100, 300);
		for (const call of context.drawImage.mock.calls.slice(1))
			expect(call[3]).toBeCloseTo(0.9 * geometry.interline);
	});
	it('does not encode predicted vertical positions into independent review images', () => {
		const { context } = canvasMock();
		appendPitchPanels(source, measure, geometry, notes, 100, 300);
		const draws = [...context.drawImage.mock.calls],
			labels = [...context.fillText.mock.calls];
		context.drawImage.mockClear();
		context.fillText.mockClear();
		appendPitchPanels(
			source,
			measure,
			geometry,
			notes.map((n) => ({ ...n, position: n.position + 5 })),
			100,
			300
		);
		expect(context.drawImage.mock.calls).toEqual(draws);
		expect(context.fillText.mock.calls).toEqual(labels);
	});
	it('keeps the original crop when there are no heads or too many panels', () => {
		const { context } = canvasMock();
		for (const heads of [[], Array(13).fill(notes[0])])
			expect(appendPitchPanels(source, measure, geometry, heads, 100, 300)).toBe(measure);
		expect(context.drawImage).not.toHaveBeenCalled();
	});
});

it('retains the natural before a scanned opening note without including the previous measure', () => {
	expect(measureSourceLeft(269, 0, 19.75)).toBeLessThanOrEqual(254);
	expect(measureSourceLeft(269, 1, 19.75)).toBe(269);
	expect(measureSourceLeft(10, 0, 20)).toBe(0);
});
