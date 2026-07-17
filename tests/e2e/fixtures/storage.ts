import type { Page } from '@playwright/test';

/**
 * Seed localStorage entries before the page loads.
 *
 * Storage is per-user namespaced (src/lib/persistence/namespace.ts): an
 * authenticated user's data lives under `mankunku:u:<uid>:<key>`, anonymous
 * data at the bare `mankunku:<key>` path. This fixture derives the active
 * namespace from the SAME `e2e-test-user` cookie the server hook reads, so
 * signed-in tests seed the right bucket automatically (no per-spec changes) and
 * anonymous tests keep using the bare path.
 *
 * For signed-in tests it also pre-stamps the `__active` pointer + `__schema`
 * marker so the client resolves the user's namespace up-front — without a real
 * Supabase auth cookie the client can't derive the uid otherwise, and would
 * otherwise re-home + reload on first load.
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
		Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)])
	);
	await page.addInitScript((data) => {
		const ROOT = 'mankunku:';
		// Derive the active namespace from the e2e-test-user cookie.
		let uid: string | null = null;
		const m = document.cookie.match(/(?:^|; )e2e-test-user=([^;]+)/);
		if (m) {
			try {
				uid = JSON.parse(decodeURIComponent(m[1])).id ?? null;
			} catch {
				uid = null;
			}
		}
		const prefix = uid ? `${ROOT}u:${uid}:` : ROOT;
		if (uid) {
			// Home the namespace so the app resolves the right bucket immediately
			// (no reconcile-triggered reload) and the one-time upgrade doesn't
			// reset the pointer to anon.
			if (window.localStorage.getItem(`${ROOT}__schema`) === null) {
				window.localStorage.setItem(`${ROOT}__schema`, '2');
			}
			if (window.localStorage.getItem(`${ROOT}__active`) === null) {
				window.localStorage.setItem(`${ROOT}__active`, JSON.stringify(uid));
			}
		}
		for (const [k, v] of Object.entries(data)) {
			const key = prefix + k;
			if (window.localStorage.getItem(key) === null) {
				window.localStorage.setItem(key, v as string);
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
