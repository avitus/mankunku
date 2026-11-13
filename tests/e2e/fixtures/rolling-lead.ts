import { expect } from '@playwright/test';

/**
 * The lead the rolling renderer demands before a committed note sounds:
 * Tone's 0.1 s lookahead + the 0.025 s scheduler interval + 0.01 s safety
 * (`createRollingBackingRenderer` `horizon().dispatchThrough`).
 */
export const ROLLING_DISPATCH_LEAD_SECONDS = 0.135;

interface RollingTake {
	ppq: number;
	startAudioTime: number;
	params: { tempo: number };
	generated: Record<'bassEvents' | 'compEvents' | 'drumEvents', { time: string }[]>;
	provenance: { renderTimings: { barIndex: number; renderStartedAt: number; renderElapsedSeconds: number; accepted: boolean }[] };
}

/**
 * Every bar of an exported take was committed while its first note was still
 * a full dispatch lead away, counting the whole of its generation time.
 *
 * This is the beat-lock evidence that replaced "no bar took over 25 ms"
 * (2026-11-12): a bar's generation time says nothing about whether its notes
 * could still be scheduled, and Linux WebKit pauses 15–30 ms a few times a
 * take with a third of a second in hand. Returns the smallest lead, seconds.
 */
export function expectEveryBarCommittedWithLead(playback: RollingTake, bars: number): number {
	const { ppq, startAudioTime } = playback;
	const secondsPerTick = 60 / playback.params.tempo / ppq;
	const ticks = Object.values(playback.generated).flat().map(event => parseInt(event.time, 10));
	const timings = playback.provenance.renderTimings;
	expect(timings.map(timing => timing.barIndex)).toEqual(Array.from({ length: bars }, (_, bar) => bar));
	let smallest = Infinity;
	for (const timing of timings) {
		expect(timing.accepted).toBe(true);
		expect(timing.renderElapsedSeconds).toBeGreaterThanOrEqual(0);
		const barStart = timing.barIndex * 4 * ppq;
		const inBar = ticks.filter(tick => tick >= barStart && tick < barStart + 4 * ppq);
		const firstNote = startAudioTime + (inBar.length ? Math.min(...inBar) : barStart) * secondsPerTick;
		// The audio clock read when generation began, plus the wall-clock time it took.
		const lead = firstNote - (timing.renderStartedAt + timing.renderElapsedSeconds);
		expect(lead, `bar ${timing.barIndex} lead`).toBeGreaterThan(ROLLING_DISPATCH_LEAD_SECONDS);
		smallest = Math.min(smallest, lead);
	}
	return smallest;
}
