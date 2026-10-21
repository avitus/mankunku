import { describe, expect, it, vi } from 'vitest';
import { canvasToPng } from '$lib/tunes/import/pdf-canvas';

describe('temporary PDF raster buffers', () => {
	it('encodes the full-resolution image before releasing its native buffer', () => {
		const canvas = {
			width: 2448,
			height: 3168,
			toDataURL: vi.fn(() => {
				expect([canvas.width, canvas.height]).toEqual([2448, 3168]);
				return 'data:image/png;base64,encoded';
			})
		};
		expect(canvasToPng(canvas as unknown as HTMLCanvasElement)).toBe(
			'data:image/png;base64,encoded'
		);
		expect(canvas.toDataURL).toHaveBeenCalledWith('image/png');
		expect([canvas.width, canvas.height]).toEqual([0, 0]);
	});
	it('also releases the buffer when encoding fails', () => {
		const canvas = {
			width: 2448,
			height: 3168,
			toDataURL: () => {
				throw new Error('encoding failed');
			}
		};
		expect(() => canvasToPng(canvas as unknown as HTMLCanvasElement)).toThrow('encoding failed');
		expect([canvas.width, canvas.height]).toEqual([0, 0]);
	});
});
