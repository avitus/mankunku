import type { DriveStep } from 'driver.js';

/**
 * Tune-practice tour — a walkthrough of the scored session reached from
 * "Practice licks" on any tune.
 *
 * Deliberately ELEMENT-FREE. The session lives at /tunes/<id>/practice, which
 * has no static path Settings' replay could navigate to, and its setup
 * controls only exist once a tune is open. Elementless steps read identically
 * from the Tunes page (where the tour is registered) and from the setup screen
 * itself (via the in-context TourTrigger) — same pattern as lickPracticeTour.
 */
export const tunePracticeTour: DriveStep[] = [
	{
		popover: {
			title: 'Playing over tunes',
			description:
				"Side A trains your ear. Side B drills a line into your fingers in all 12 keys. This is where they pay off: the rhythm section plays a real form, and at every spot your vocabulary fits, you get the space — and a score.",
			align: 'center'
		}
	},
	{
		popover: {
			title: 'Insertion points',
			description:
				"Before you start, Mankunku reads the tune's changes and finds the progressions it knows — short and long ii-V-Is, turnarounds, iii-VI-ii-V-I, vamps, blues. Each match becomes a scored window in a specific local key, and the setup screen tells you what it found: “6 insertion points: 3× Short ii-V-I (Maj)…”",
			align: 'center'
		}
	},
	{
		popover: {
			title: 'It suggests licks you can actually play',
			description:
				"Suggestions are licks that fit that progression, ranked by what YOU have unlocked and drilled in that key. In Suggest mode it only names licks you already have in that key, at the session tempo or faster, so it won't ask for a line in a key you haven't earned. Licks with no progression tag can't be suggested — the setup screen links you off to fix that.",
			align: 'center'
		}
	},
	{
		popover: {
			title: 'The head plays once',
			description:
				"Jazz convention, implemented literally. With the Head switch on, the melody plays one chorus, then the staff clears and the changes are yours. On a chart whose repeats outline the whole form, pass one IS the head and pass two is your chorus; on other charts a solo chorus is appended. A chords-only chart has no head, so the switch sits at OFF — the caption under Start tells you which way the take opens.",
			align: 'center'
		}
	},
	{
		popover: {
			title: 'Three modes',
			description:
				"Suggest names the lick for you at every insertion point — start here. Points lets you pick, scores you out of 100, and DOUBLES a window when it and the one before it both clear 90%. Freestyle drops the windows entirely: just solo, and the app applauds the licks from your book it recognises.",
			align: 'center'
		}
	},
	{
		popover: {
			title: 'Strictness',
			description:
				"Guided names the lick to play over each insertion point. Standard names only the progression, so the vocabulary is yours — any lick of yours that fits counts. Solo shows nothing. It changes what you're told, never how the app listens (any octave, at every level) or the grading scale, so a score means the same thing everywhere.",
			align: 'center'
		}
	},
	{
		popover: {
			title: 'Nothing here counts against you',
			description:
				"Tune takes don't touch your streak, your level, or your Side B key unlocks — this is the applying-it room, not a drilling room. Use the report to spot which insertion points you keep fumbling, then go drill those licks on Side B and come back.",
			align: 'center'
		}
	}
];
