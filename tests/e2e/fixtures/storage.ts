import type { Page } from '@playwright/test';

const PREFIX = 'mankunku:';

/**
 * Seed localStorage entries before the page loads.
 *
 * Use this to set up app state without going through UI clicks. Values are
 * JSON-encoded to match the format produced by src/lib/persistence/storage.ts
 * (which prefixes every key with 'mankunku:').
 *
 * Call BEFORE page.goto() — this uses addInitScript so the script runs on
 * every navigation in the context, including reloads.
 *
 * IDEMPOTENT: only sets keys that aren't already present. This lets tests
 * exercise persistence by clicking + reloading: the first navigation seeds,
 * subsequent ones leave the user's mutations intact.
 */
export async function seedStorage(
	page: Page,
	entries: Record<string, unknown>
): Promise<void> {
	const payload = Object.fromEntries(
		Object.entries(entries).map(([k, v]) => [PREFIX + k, JSON.stringify(v)])
	);
	await page.addInitScript((data) => {
		for (const [k, v] of Object.entries(data)) {
			if (window.localStorage.getItem(k) === null) {
				window.localStorage.setItem(k, v as string);
			}
		}
	}, payload);
}

/**
 * Default settings that mark onboarding complete and skip the welcome tour
 * banner so a clean test browser doesn't get blocked by the onboarding modal.
 *
 * Override individual fields in tests as needed. Shape matches
 * `defaultSettings` in src/lib/state/settings.svelte.ts.
 */
export const SETTINGS_ONBOARDED = {
	instrumentId: 'tenor-sax',
	defaultTempo: 100,
	masterVolume: 0.8,
	metronomeEnabled: true,
	metronomeVolume: 0.7,
	backingTrackEnabled: true,
	backingInstrument: 'piano',
	backingTrackVolume: 0.6,
	backingStyle: 'swing',
	swing: 0.5,
	theme: 'dark',
	onboardingComplete: true,
	tonalityOverride: null,
	highestNote: null,
	bleedFilterEnabled: false
};

/**
 * Tour state with all tours marked dismissed — keeps the welcome banner and
 * any per-route tour overlays from appearing in tests that aren't specifically
 * about them. Shape matches PersistedShape in src/lib/state/tour.svelte.ts.
 */
export const TOUR_DISMISSED = {
	completed: [] as string[],
	dismissed: ['welcome', 'home', 'ear-training', 'lick-practice', 'library', 'community', 'add-licks', 'progress', 'settings', 'docs']
};

/**
 * Convenience: seed the minimum state so an anonymous user lands on a clean
 * UI without onboarding overlays or tour banners blocking interaction.
 */
export async function seedOnboardedAnonymous(page: Page): Promise<void> {
	await seedStorage(page, {
		settings: SETTINGS_ONBOARDED,
		'tour-state': TOUR_DISMISSED
	});
}
