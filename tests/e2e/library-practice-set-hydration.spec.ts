import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedUserLicks, seedStorage } from './fixtures/storage';
import { SAMPLE_USER_LICKS } from './fixtures/storage';

/**
 * Regression: signed-out /library with a practice set used to blow up with
 * `effect_update_depth_exceeded`.
 *
 * `hydrateLickPracticeProgress` writes a fresh `lickPractice.progress` object
 * and then calls `pickInitialProgression`, which reads it. Both pages call the
 * hydrate from an `$effect`, so the read was tracked and the write re-triggered
 * the effect forever.
 *
 * Two conditions had to coincide, which is why no existing spec caught it:
 *   - **Signed out.** With a Supabase client the `await` inside the hydrate
 *     splits the function, so the writes land outside the tracking window.
 *   - **A non-empty practice set.** `pickInitialProgression` early-returns
 *     before reading `lickPractice.progress` when nothing is practice-tagged,
 *     and every other library spec seeds untagged licks.
 */

test('signed-out library with a practice set hydrates without an effect loop', async ({
	page,
	consoleCollector: _c
}) => {
	await seedOnboardedAnonymous(page);
	await seedUserLicks(page, SAMPLE_USER_LICKS);
	await seedStorage(page, {
		'user-lick-tags': {
			'e2e-user-lick-bebop': ['practice', 'prog:blues']
		}
	});

	const pageErrors: string[] = [];
	page.on('pageerror', (e) => pageErrors.push(String(e)));

	await page.goto('/library');
	await expect(page.locator('main').getByRole('heading', { level: 3 }).first()).toBeVisible();

	// The loop is asynchronous — it needs a beat to blow the effect depth limit.
	await page.waitForTimeout(1500);

	expect(pageErrors.join('\n')).not.toContain('effect_update_depth_exceeded');
	expect(pageErrors, 'signed-out library should hydrate cleanly').toEqual([]);
});
