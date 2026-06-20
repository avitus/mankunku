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

/**
 * Sample user-entered licks. The /library page lists only the user's own (and
 * adopted) licks — curated licks no longer render there — so tests that need
 * cards on the page must seed a personal collection. Shape matches `Phrase`
 * (src/lib/types/music.ts); kept loosely typed to avoid a `$lib` import here.
 */
export const SAMPLE_USER_LICKS: unknown[] = [
	{
		id: 'e2e-user-lick-bebop',
		name: 'Test Bebop Line',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 62, duration: [1, 8], offset: [1, 8] },
			{ pitch: 64, duration: [1, 8], offset: [1, 4] },
			{ pitch: 65, duration: [1, 8], offset: [3, 8] }
		],
		harmony: [
			{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [1, 1] }
		],
		difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 1 },
		category: 'bebop-lines',
		tags: [],
		source: 'user-entered'
	},
	{
		id: 'e2e-user-lick-blues',
		name: 'Test Blues Riff',
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },
			{ pitch: 63, duration: [1, 4], offset: [1, 4] },
			{ pitch: 65, duration: [1, 4], offset: [1, 2] },
			{ pitch: 67, duration: [1, 4], offset: [3, 4] }
		],
		harmony: [
			{ chord: { root: 'C', quality: '7' }, scaleId: 'blues.minor', startOffset: [0, 1], duration: [1, 1] }
		],
		difficulty: { level: 25, pitchComplexity: 25, rhythmComplexity: 20, lengthBars: 1 },
		category: 'blues',
		tags: [],
		source: 'user-entered'
	}
];

/**
 * Seed the user's personal lick collection into localStorage. Call before
 * page.goto(). Defaults to {@link SAMPLE_USER_LICKS}.
 */
export async function seedUserLicks(
	page: Page,
	licks: unknown[] = SAMPLE_USER_LICKS
): Promise<void> {
	await seedStorage(page, { 'user-licks': licks });
}
