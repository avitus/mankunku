import type { DriveStep } from 'driver.js';

/**
 * Ear-training tour — assumes the user is on /ear-training. Walks through
 * the play button, the listen-then-respond rhythm, and how the score
 * breaks down into pitch and rhythm components.
 */
export const earTrainingTour: DriveStep[] = [
	{
		popover: {
			title: 'How a session works',
			description:
				"Mankunku plays a phrase, then waits for you to play it back on your instrument. The mic captures your audio, segments it into notes, and scores each one against the original.",
			align: 'center'
		}
	},
	{
		element: '[data-tour="play-button"]',
		popover: {
			title: 'Start the loop',
			description:
				"Tap once to start. After a bar of click the app plays the phrase; then the click keeps going and it's your turn — the mic is already open, so come in when you're ready. After your take it scores you and moves on (passed) or plays the same phrase once more (didn't pass). Tap again to stop.",
			side: 'top',
			align: 'center'
		}
	},
	{
		element: '[data-tour="status-text"]',
		popover: {
			title: 'What you should do right now',
			description:
				'Tells you the current state of the loop: "Listen" in red while the phrase plays, "Your turn" in brass when it’s your move, "Listening" while you play. Red means listen, brass means play — everywhere in the app.',
			side: 'top',
			align: 'center'
		}
	},
	{
		element: '[data-tour="score-display"]',
		popover: {
			title: 'Reading the score',
			description:
				"Pitch accuracy weighted 60%, rhythm 40%. 70% or better counts as a pass. The colour gives you the grade at a glance; the percentage tells you the gap. Pitch and rhythm break out separately so you know where to focus.",
			side: 'top',
			align: 'start'
		}
	},
	{
		popover: {
			title: 'How to improve',
			description:
				"Stumbling on rhythm? Lower the tempo in Settings. Stumbling on pitch? There's no difficulty dial to turn — your level follows your last 25 takes in the scale, so a run of misses eases the material off on its own, and clean takes push it up.",
			align: 'center'
		}
	}
];
