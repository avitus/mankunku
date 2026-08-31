import { test, expect } from './fixtures/test';
import { seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';

/**
 * Keys & Scales unlock card — replaces the old "Adaptive Difficulty" card.
 *
 * The old card showed the global pitch/rhythm complexity ratchet, a metric
 * whose feedback loop was severed (nothing consumed it) and which saturated
 * at 100/100 for any regular user. This spec pins its removal and pins that
 * the replacement reports the live unlock system: keys/scales unlocked out
 * of 12, plus the next unlock and what it requires.
 */

function proficiency(level: number) {
	return {
		level,
		recentScores: [0.9, 0.85],
		attemptsAtLevel: 2,
		attemptsSinceChange: 2,
		totalAttempts: 20
	};
}

test('unlock card shows counts and next requirements; adaptive card is gone', async ({
	page,
	consoleCollector: _c
}) => {
	await seedStorage(page, {
		settings: SETTINGS_ONBOARDED,
		'tour-state': TOUR_DISMISSED,
		progress: {
			sessions: [],
			// Unlocked scales: major-pent, minor-pent, major, blues, dorian, minor → 6/12.
			// Mixolydian is the frontier (needs major ≥ 20, currently 18).
			scaleProficiency: {
				'major-pentatonic': proficiency(15),
				'minor-pentatonic': proficiency(20),
				major: proficiency(18),
				dorian: proficiency(25)
			},
			// Unlocked keys: C, G, F → 3/12. D is the frontier (needs G ≥ 10, currently 7).
			keyProficiency: { C: proficiency(10), G: proficiency(7) }
		}
	});

	await page.goto('/progress');

	const card = page.locator('[data-tour="unlocks"]');
	await expect(card).toBeVisible();
	await expect(card).toContainText('Keys & Scales');
	await expect(card).toContainText('3/12');
	await expect(card).toContainText('6/12');
	await expect(card).toContainText('Next: D — G ≥ 10 (now 7)');
	await expect(card).toContainText('Next: Mixolydian — Major ≥ 20 (now 18)');

	// The dead ratchet display is gone.
	await expect(page.locator('body')).not.toContainText('Adaptive Difficulty');
	await expect(page.locator('body')).not.toContainText('Pitch Complexity');
	await expect(page.locator('body')).not.toContainText('Rhythm Complexity');
});

test('fully unlocked state reads as complete, not saturated', async ({
	page,
	consoleCollector: _c
}) => {
	const scaleProficiency = Object.fromEntries(
		[
			'major-pentatonic', 'minor-pentatonic', 'major', 'blues', 'dorian', 'mixolydian',
			'minor', 'lydian', 'melodic-minor', 'altered', 'lydian-dominant', 'bebop-dominant'
		].map(s => [s, proficiency(40)])
	);
	const keyProficiency = Object.fromEntries(
		['C', 'G', 'F', 'D', 'Bb', 'A', 'Eb', 'E', 'Ab', 'B', 'Db', 'F#'].map(k => [
			k,
			proficiency(15)
		])
	);

	await seedStorage(page, {
		settings: SETTINGS_ONBOARDED,
		'tour-state': TOUR_DISMISSED,
		progress: { sessions: [], scaleProficiency, keyProficiency }
	});

	await page.goto('/progress');

	const card = page.locator('[data-tour="unlocks"]');
	await expect(card).toBeVisible();
	await expect(card).toContainText('12/12');
	await expect(card).toContainText('All 12 unlocked');
	await expect(card).not.toContainText('Next:');
});
