import type { Page } from '@playwright/test';

/**
 * Pin "now" for every document the page loads — `Date.now()`, `new Date()`
 * and `Date()` all read `at` — and touch nothing else. Call before the first
 * navigation.
 *
 * Use this, not `page.clock.setFixedTime`, when a spec only needs a fixed
 * calendar. The clock fakes every timer too, so Sentry finds `setTimeout`
 * non-native and takes one from a sandbox iframe, which gets a fake clock of
 * its own. Replay's debounce then sets timers on that clock and clears them
 * on the page's, and both number timers from the same start: a cleared id
 * that is the page's idle callback throws "Cannot clear timer: timer created
 * with requestIdleCallback() but cleared with clearTimeout()" — progress-
 * trend-chart, 1 run in 10 (2026-10-20). freeze-date.spec.ts pins the
 * timers staying native.
 */
export async function freezeDate(page: Page, at: Date): Promise<void> {
	await page.addInitScript((now: number) => {
		const RealDate = Date;
		/** Date with "now" fixed: called bare it gives the string, constructed bare the fixed instant. */
		function FixedDate(this: unknown, ...args: unknown[]): Date | string {
			if (!new.target) return new RealDate(now).toString();
			return args.length > 0
				? new RealDate(...(args as ConstructorParameters<DateConstructor>))
				: new RealDate(now);
		}
		FixedDate.prototype = RealDate.prototype;
		FixedDate.now = (): number => now;
		FixedDate.parse = RealDate.parse;
		FixedDate.UTC = RealDate.UTC;
		globalThis.Date = FixedDate as unknown as DateConstructor;
	}, at.getTime());
}
