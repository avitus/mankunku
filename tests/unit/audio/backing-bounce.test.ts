import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BOUNCE_SECONDS, BOUNCE_SAMPLE_RATE, renderEventsToWav } from '$lib/audio/backing-bounce';
import { DEFAULT_BACKING_MIX } from '$lib/audio/backing-mix';

const offline = vi.hoisted(() => ({
	imports: 0,
	render: vi.fn(async () => { throw new Error('offline allocation attempted'); })
}));
vi.mock('smplr', () => {
	offline.imports++;
	return { renderOffline: offline.render, Smolken: vi.fn(), SplendidGrandPiano: vi.fn(),
		Soundfont: vi.fn(), Sampler: vi.fn(), Scheduler: vi.fn() };
});

const generated = { bassEvents: [], compEvents: [], drumEvents: [] };
const opts = { tempo: 140, instrument: 'piano' as const, volume: 0.7, mix: DEFAULT_BACKING_MIX };

describe('browser WAV allocation bound', () => {
	beforeEach(() => { offline.render.mockClear(); });

	it('rejects invalid and oversized durations before loading or allocating offline audio', async () => {
		for (const durationSeconds of [0, -1, NaN, Infinity, -Infinity, MAX_BOUNCE_SECONDS + 0.001]) {
			await expect(renderEventsToWav(generated, {}, { ...opts, durationSeconds })).rejects.toThrow(
				'Browser WAV bounce is limited to 10 minutes. Export events JSON or use a shorter take.'
			);
		}
		expect(offline.imports).toBe(0);
		expect(offline.render).not.toHaveBeenCalled();
	});

	it('allows a duration exactly at the bound, with the tail included in that duration', async () => {
		await expect(renderEventsToWav(generated, {}, { ...opts, durationSeconds: MAX_BOUNCE_SECONDS }))
			.rejects.toThrow('offline allocation attempted');
		expect(offline.render).toHaveBeenCalledOnce();
		expect(offline.render).toHaveBeenCalledWith(expect.any(Function), {
			duration: 600, sampleRate: BOUNCE_SAMPLE_RATE
		});
	});
});
