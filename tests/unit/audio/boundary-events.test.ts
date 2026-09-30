import { describe, expect, it, vi } from 'vitest';
import { scheduleBoundaryEvents } from '$lib/audio/boundary-events';

describe('backing entrance at a continuous cycle boundary', () => {
	it('sounds the downbeat and humanized opening hits once, at their audio times', () => {
		const events = ['-3i', '0i', '4i', '240i', '480i'].map(time => ({ time }));
		const play = vi.fn();
		const future = scheduleBoundaryEvents(events, play, {
			audioTime: 10,
			startTick: 1920,
			throughTick: 1930,
			secondsPerTick: 60 / 120 / 480
		});
		expect(future).toEqual(events.slice(3));
		expect(play.mock.calls.map(([time]) => time)).toEqual([
			10 - 3 / 960, 10, 10 + 4 / 960
		]);
		expect(play.mock.calls.map(([, event]) => event)).toEqual(events.slice(0, 3));
	});

	it('uses the new tempo for opening hits after a bump', () => {
		const play = vi.fn();
		scheduleBoundaryEvents([{ time: '12i' }], play, {
			audioTime: 10, startTick: 1920, throughTick: 1932, secondsPerTick: 60 / 132 / 480
		});
		expect(play.mock.calls[0][0]).toBeCloseTo(10 + 12 * 60 / 132 / 480);
	});

	it('leaves normal advance scheduling entirely to the transport', () => {
		const events = [{ time: '0i' }, { time: '240i' }];
		const play = vi.fn();
		expect(scheduleBoundaryEvents(events, play)).toEqual(events);
		expect(play).not.toHaveBeenCalled();
	});
});
