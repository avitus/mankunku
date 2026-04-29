import type { DriveStep } from 'driver.js';

/**
 * Library tour — assumes the user is on /library. Covers browsing,
 * filtering, tagging for practice, and the community-licks story.
 */
export const libraryTour: DriveStep[] = [
	{
		popover: {
			title: 'The Lick Library',
			description:
				"Curated jazz licks bundled with the app, plus your own recorded or step-entered licks, plus community licks you've adopted. Filter, search, and pull lines into your practice rotation.",
			side: 'over',
			align: 'center'
		}
	},
	{
		element: '[data-tour="category-filter"]',
		popover: {
			title: 'Browse by category',
			description:
				"Categories group licks by harmonic context — ii–V–I, blues, bebop lines, modal, etc. Filter to focus practice on one shape at a time.",
			side: 'bottom',
			align: 'start'
		}
	},
	{
		element: '[data-tour="difficulty-filter"]',
		popover: {
			title: 'Cap by difficulty',
			description:
				"Difficulty 1–100 reflects pitch range, rhythmic density, and harmonic complexity. The library can be overwhelming — cap the difficulty to focus on what's near your level.",
			side: 'top',
			align: 'start'
		}
	},
	{
		element: '[data-tour="practice-tag"]',
		popover: {
			title: 'Tag for practice',
			description:
				"Star a lick to tag it for Lick Practice — Side B will rotate it through all 12 keys at increasing tempo. The Practice filter here shows just your tagged set.",
			side: 'right',
			align: 'start'
		}
	},
	{
		popover: {
			title: 'Community licks',
			description:
				"Other users publish licks they've recorded. Browse the Community page to adopt them into your library — once adopted, they behave like any other lick.",
			side: 'over',
			align: 'center'
		}
	}
];
