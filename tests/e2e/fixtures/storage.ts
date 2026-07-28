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
	const ROOT = 'mankunku:';
	// Resolve the active namespace ONCE, now, from the e2e-test-user cookie the
	// auth fixture already set on the context — rather than re-parsing
	// document.cookie on every navigation (which would re-derive from a cookie
	// the test may have since changed, seeding the wrong bucket).
	let uid: string | null = null;
	try {
		const cookies = await page.context().cookies();
		const c = cookies.find((ck) => ck.name === 'e2e-test-user');
		if (c) uid = JSON.parse(decodeURIComponent(c.value)).id ?? null;
	} catch {
		uid = null;
	}
	const prefix = uid ? `${ROOT}u:${uid}:` : ROOT;
	const payload = Object.fromEntries(
		Object.entries(entries).map(([k, v]) => [prefix + k, JSON.stringify(v)])
	);
	// Signed-in: pre-stamp the namespace pointer + schema so the client resolves
	// the right bucket up-front (no re-home reload; the upgrade stays a no-op).
	const control = uid
		? { schemaKey: `${ROOT}__schema`, activeKey: `${ROOT}__active`, activeVal: JSON.stringify(uid) }
		: null;
	await page.addInitScript(
		({ data, control }) => {
			if (control) {
				if (window.localStorage.getItem(control.schemaKey) === null) {
					window.localStorage.setItem(control.schemaKey, '3');
				}
				if (window.localStorage.getItem(control.activeKey) === null) {
					window.localStorage.setItem(control.activeKey, control.activeVal);
				}
			}
			for (const [k, v] of Object.entries(data)) {
				if (window.localStorage.getItem(k) === null) {
					window.localStorage.setItem(k, v as string);
				}
			}
		},
		{ data: payload, control }
	);
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
	dismissed: ['welcome', 'home', 'ear-training', 'lick-practice', 'licks', 'tunes', 'progress', 'settings', 'docs']
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
 * Sample user-entered licks. The /licks page lists only the user's own (and
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

/**
 * Sample user-entered tune: a 2-section form with melody, chords, and a
 * repeat, exercising the multi-system chart rendering. Shape matches
 * `Tune` (src/lib/types/tune.ts); loosely typed to avoid `$lib`.
 */
export const SAMPLE_USER_TUNES: unknown[] = [
	{
		id: 'e2e-user-sheet-1',
		title: 'Test Session Tune',
		composer: 'E2E',
		key: 'C',
		timeSignature: [4, 4],
		style: 'Medium Swing',
		tags: ['e2e'],
		sections: [
			{
				label: 'A',
				bars: 2,
				repeatStart: true,
				repeatEnd: true,
				notes: [
					{ pitch: 60, duration: [1, 2], offset: [0, 1] },
					{ pitch: 64, duration: [1, 2], offset: [1, 2] },
					{ pitch: 67, duration: [1, 1], offset: [1, 1] }
				],
				harmony: [
					{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [1, 2], symbol: 'Dm7' },
					{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [1, 2], duration: [1, 2], symbol: 'G7' },
					{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [1, 1], duration: [1, 1], symbol: 'Cmaj7' }
				]
			},
			{
				label: 'B',
				bars: 2,
				notes: [{ pitch: 65, duration: [1, 1], offset: [0, 1] }],
				harmony: [
					{ chord: { root: 'F', quality: 'maj7' }, scaleId: 'major.lydian', startOffset: [0, 1], duration: [2, 1], symbol: 'Fmaj7' }
				]
			}
		],
		source: 'user'
	}
];

/**
 * Seed the user's tune book into localStorage. Call before page.goto().
 * Defaults to {@link SAMPLE_USER_TUNES}.
 */
export async function seedTunes(
	page: Page,
	sheets: unknown[] = SAMPLE_USER_TUNES
): Promise<void> {
	await seedStorage(page, { 'user-tunes': sheets });
}
