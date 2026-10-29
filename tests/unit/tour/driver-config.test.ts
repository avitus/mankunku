/**
 * `runTour` marks a tour complete ONLY on natural completion — Next on the
 * last step. Esc, the X button or an overlay click destroy the driver too, but
 * mean "not finished yet": the banner must come back so the user can retry, so
 * those paths call `onClose` and never `markComplete` (which also syncs the
 * completion to the cloud, where it suppresses the tour on every device).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from 'driver.js';

const { driverMock, captured, markComplete, tourState } = vi.hoisted(() => {
	const captured: { config: Config | null } = { config: null };
	const tourState = { tourInProgress: null as string | null };
	return {
		captured,
		tourState,
		markComplete: vi.fn(),
		driverMock: vi.fn((config: Config) => {
			captured.config = config;
			return { drive: vi.fn() };
		})
	};
});

vi.mock('driver.js', () => ({ driver: driverMock }));
vi.mock('$lib/state/tour.svelte', () => ({ tourState, markComplete }));

import { runTour } from '$lib/tour/driver-config';

/** The driver handle the step callbacks receive as `ctx.driver`. */
function fakeDriver(isLast: boolean) {
	return {
		isLastStep: vi.fn(() => isLast),
		moveNext: vi.fn(),
		destroy: vi.fn(() => captured.config!.onDestroyed!(undefined, {}, {} as never))
	};
}

function clickNext(isLast: boolean) {
	const d = fakeDriver(isLast);
	captured.config!.onNextClick!(undefined, {}, { driver: d } as never);
	return d;
}

const supabase = { auth: {} } as never;

beforeEach(() => {
	vi.clearAllMocks();
	captured.config = null;
	tourState.tourInProgress = null;
});

describe('runTour', () => {
	it('Next on the last step marks the tour complete (with the cloud client) and runs onComplete', () => {
		const onComplete = vi.fn();
		const onClose = vi.fn();
		runTour({ tourId: 'welcome', steps: [], supabase, onComplete, onClose });
		expect(tourState.tourInProgress).toBe('welcome');

		const d = clickNext(true);

		expect(d.destroy).toHaveBeenCalledTimes(1);
		expect(markComplete).toHaveBeenCalledWith('welcome', supabase);
		expect(onComplete).toHaveBeenCalledTimes(1);
		expect(onClose).not.toHaveBeenCalled();
		expect(tourState.tourInProgress).toBeNull();
	});

	it('Next before the last step only advances', () => {
		runTour({ tourId: 'welcome', steps: [] });
		const d = clickNext(false);
		expect(d.moveNext).toHaveBeenCalledTimes(1);
		expect(d.destroy).not.toHaveBeenCalled();
		expect(markComplete).not.toHaveBeenCalled();
	});

	it('closing early (Esc / X / overlay) is not completion: onClose runs, markComplete never does', () => {
		const onComplete = vi.fn();
		const onClose = vi.fn();
		runTour({ tourId: 'welcome', steps: [], supabase, onComplete, onClose });
		clickNext(false);

		captured.config!.onDestroyed!(undefined, {}, {} as never);

		expect(markComplete).not.toHaveBeenCalled();
		expect(onComplete).not.toHaveBeenCalled();
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(tourState.tourInProgress).toBeNull();
	});

	it("leaves tourInProgress alone when another tour has taken it over", () => {
		runTour({ tourId: 'welcome', steps: [] });
		tourState.tourInProgress = 'licks';
		captured.config!.onDestroyed!(undefined, {}, {} as never);
		expect(tourState.tourInProgress).toBe('licks');
	});
});
