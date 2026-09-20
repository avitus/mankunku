import { describe, expect, it, vi } from 'vitest';

/**
 * `getTransportClockAt` is the capture-timing read of the transport: the
 * position AT an audio-clock time, which carries no lookahead, beside the
 * lookahead itself. `Transport.seconds` (what `getTransportSeconds` stamps)
 * reads the position at `currentTime + lookAhead`; the diagnostic exists to
 * measure that difference, so it must not read the same field.
 */

const transport = vi.hoisted(() => ({
	stop: vi.fn(),
	cancel: vi.fn(),
	position: 0,
	seconds: 99,
	getSecondsAtTime: vi.fn((t: number) => t - 2)
}));

vi.mock('tone', () => ({
	getTransport: () => transport,
	getContext: () => ({ lookAhead: 0.1 })
}));
vi.mock('$lib/audio/metronome', () => ({ disposeMetronome: vi.fn() }));
vi.mock('$lib/audio/backing-track', () => ({ disposeBackingParts: vi.fn() }));
vi.mock('$lib/audio/audio-context', () => ({}));

describe('getTransportClockAt', () => {
	it('is null before Tone loads, then reads the position at the given audio time and the lookahead', async () => {
		const { getTransportClockAt, stopPlayback } = await import('$lib/audio/playback');
		expect(getTransportClockAt(12)).toBeNull();

		await stopPlayback(); // loads Tone
		expect(getTransportClockAt(12)).toEqual({ secondsAtContextTime: 10, lookAhead: 0.1 });
		expect(transport.getSecondsAtTime).toHaveBeenCalledWith(12);
	});
});
