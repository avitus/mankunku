import { test, expect } from './fixtures/test';
import { freezeDate } from './fixtures/date';

/**
 * `freezeDate` pins the calendar and nothing else. The specs that need a
 * fixed "today" used `page.clock.setFixedTime`, which also swaps every timer
 * for a fake: Sentry then judges `setTimeout` non-native, takes one from a
 * sandbox iframe that carries its own fake clock, and Replay's debounce
 * cancels that timer through the page's `clearTimeout` — the two clocks
 * number timers alike, so 1 run in 10 it hit an idle callback and threw
 * (progress-trend-chart, 2026-10-20). Native timers are the property that
 * matters, so it is the one pinned.
 */
const NOW = new Date('2026-07-19T12:00:00Z');

test('freezeDate pins the calendar and leaves the timers native', async ({ page }) => {
	await freezeDate(page, NOW);
	await page.goto('/');

	const probe = await page.evaluate(() => {
		/** Whether `fn` is the browser's own function — the test Sentry's isNativeFunction makes. */
		const isNative = (fn: unknown): boolean =>
			typeof fn === 'function' && /\[native code\]/.test(Function.prototype.toString.call(fn));
		return {
			now: Date.now(),
			constructed: new Date().getTime(),
			explicit: new Date('2020-01-02T00:00:00Z').getTime(),
			called: typeof (Date as unknown as () => string)(),
			isDate: new Date() instanceof Date,
			timers: [setTimeout, clearTimeout, setInterval, clearInterval].map(isNative)
		};
	});

	expect(probe.now).toBe(NOW.getTime());
	expect(probe.constructed).toBe(NOW.getTime());
	expect(probe.explicit).toBe(Date.UTC(2020, 0, 2));
	expect(probe.called).toBe('string');
	expect(probe.isDate).toBe(true);
	expect(probe.timers).toEqual([true, true, true, true]);
});
