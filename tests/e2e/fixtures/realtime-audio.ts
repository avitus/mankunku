import type { Page } from '@playwright/test';
import { test } from './test';

/**
 * Guard only tests about to start real-time audio. Headless Linux Firefox in
 * CI has no audio device: a user-gesture AudioContext.resume() remains pending
 * with currentTime at zero. Keep setup, validation and other non-audio tests
 * running, and keep actual playback enabled on the other browser/platforms.
 */
export function requireRealtimeAudio(page: Page): void {
	test.skip(
		page.context().browser()?.browserType().name() === 'firefox'
			&& process.platform === 'linux' && !!process.env.CI,
		'AudioContext.resume() hangs in headless Linux Firefox without an audio device'
	);
}
