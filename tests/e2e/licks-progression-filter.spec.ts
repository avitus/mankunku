import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedUserLicks, seedStorage } from './fixtures/storage';
import type { Phrase } from '$lib/types/music';

/**
 * Library progression filter.
 *
 * Matching is on explicit `prog:*` tags only — the same source
 * `getProgressionTags` feeds the practice engine — so "filtered to X" and
 * "what a session for X would draw from" are the same set. Category
 * compatibility deliberately does not widen it.
 */

function lick(id: string, name: string, category: Phrase['category']): Phrase {
	return {
		id,
		name,
		timeSignature: [4, 4],
		key: 'C',
		notes: [
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 62, duration: [1, 8], offset: [1, 8] }
		],
		harmony: [
			{
				chord: { root: 'C', quality: 'maj7' },
				scaleId: 'major.ionian',
				startOffset: [0, 1],
				duration: [1, 1]
			}
		],
		difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 1 },
		category,
		tags: [],
		source: 'user-entered'
	};
}

test.describe('library progression filter', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
		await seedUserLicks(page, [
			lick('filt-blues', 'Filter Blues Lick', 'blues'),
			lick('filt-major', 'Filter Major Lick', 'ii-V-I-major'),
			lick('filt-both', 'Filter Both Lick', 'bebop-lines'),
			lick('filt-untagged', 'Filter Untagged Lick', 'bebop-lines')
		]);
		// Explicit prog:* tags. `filt-untagged` deliberately gets none — it must
		// disappear under any progression filter even though its *category*
		// (bebop-lines) is compatible with several of them.
		await seedStorage(page, {
			'user-lick-tags': {
				'filt-blues': ['practice', 'prog:blues'],
				'filt-major': ['practice', 'prog:ii-V-I-major'],
				'filt-both': ['practice', 'prog:blues', 'prog:ii-V-I-major'],
				'filt-untagged': ['practice']
			}
		});
	});

	test('narrows the collection to licks tagged for the chosen progression', async ({
		page,
		consoleCollector: _c
	}) => {
		await page.goto('/licks');
		const cards = page.locator('main').getByRole('heading', { level: 3 });
		await expect(cards.first()).toBeVisible();
		await expect(cards).toHaveCount(4);

		const filter = page.getByLabel('Filter by progression');

		// Blues → the two blues-tagged licks, and not the ii-V-I-only one.
		await filter.selectOption({ label: 'Blues (I7 vamp)' });
		await expect(cards).toHaveCount(2);
		await expect(page.getByRole('heading', { name: 'Filter Blues Lick' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Filter Both Lick' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Filter Major Lick' })).toHaveCount(0);

		// The category-compatible-but-untagged lick stays hidden — this is the
		// whole point of matching on tags rather than inferring from category.
		await expect(page.getByRole('heading', { name: 'Filter Untagged Lick' })).toHaveCount(0);

		// Short ii-V-I (Maj) → the other pair.
		await filter.selectOption({ label: 'Short ii-V-I (Maj)' });
		await expect(cards).toHaveCount(2);
		await expect(page.getByRole('heading', { name: 'Filter Major Lick' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Filter Both Lick' })).toBeVisible();

		// Back to unfiltered.
		await filter.selectOption({ label: 'All progressions' });
		await expect(cards).toHaveCount(4);
	});

	test('explains the empty state when nothing is tagged for the progression', async ({
		page,
		consoleCollector: _c
	}) => {
		await page.goto('/licks');
		await expect(page.locator('main').getByRole('heading', { level: 3 }).first()).toBeVisible();

		await page.getByLabel('Filter by progression').selectOption({ label: 'Turnaround (I-VI-ii-V)' });

		await expect(page.getByText(/no licks are tagged for turnaround/i)).toBeVisible();
		await expect(page.locator('main').getByRole('heading', { level: 3 })).toHaveCount(0);
	});

	test('composes with the search box', async ({ page, consoleCollector: _c }) => {
		await page.goto('/licks');
		const cards = page.locator('main').getByRole('heading', { level: 3 });
		await expect(cards.first()).toBeVisible();

		await page.getByLabel('Filter by progression').selectOption({ label: 'Blues (I7 vamp)' });
		await expect(cards).toHaveCount(2);

		await page.getByPlaceholder(/find a lick/i).fill('Both');
		await expect(cards).toHaveCount(1);
		await expect(page.getByRole('heading', { name: 'Filter Both Lick' })).toBeVisible();
	});
});
