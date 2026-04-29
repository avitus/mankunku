import type { DriveStep } from 'driver.js';

/**
 * Ear-training tour — assumes the user is on /practice. Walks through
 * the play button, the listen-then-respond rhythm, and how the score
 * breaks down into pitch and rhythm components.
 */
export const earTrainingTour: DriveStep[] = [
	{
		popover: {
			title: 'How a session works',
			description:
				"Mankunku plays a phrase, then waits for you to play it back on your instrument. The mic captures your audio, segments it into notes, and scores each one against the original.",
			side: 'over',
			align: 'center'
		}
	},
	{
		element: '[data-tour="play-button"]',
		popover: {
			title: 'Start the loop',
			description:
				"Tap once to start. The app will play the phrase, give you a count-off, then listen. After your take, it scores and either advances (passed) or retries (didn't pass). Tap again to stop.",
			side: 'top',
			align: 'center'
		}
	},
	{
		element: '[data-tour="status-text"]',
		popover: {
			title: 'What you should do right now',
			description:
				'Tells you the current state of the loop: "Listen" while the phrase plays, "Your turn" when it’s your move, "Listening" while the mic captures.',
			side: 'top',
			align: 'center'
		}
	},
	{
		element: '[data-tour="score-display"]',
		popover: {
			title: 'Reading the score',
			description:
				"Pitch accuracy weighted 60%, rhythm 40%. Above 70% counts as a pass. The grade gives a quick read; the percentage tells you the gap. Pitch and rhythm break out separately so you know where to focus.",
			side: 'top',
			align: 'start'
		}
	},
	{
		popover: {
			title: 'How to improve',
			description:
				"Stumbling on rhythm? Lower the tempo in Settings. Stumbling on pitch? The app gradually expands intervals as you climb levels — back off difficulty to consolidate. The system adapts to your recent accuracy automatically.",
			side: 'over',
			align: 'center'
		}
	}
];
