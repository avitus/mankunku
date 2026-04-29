/**
 * Tooltip copy.
 *
 * Strings are written for hover/focus tooltips: short, second-person, no
 * trailing period for sentence fragments. When a concept maps to a doc
 * page, the trailing string `→ Learn more in /docs/...` is added at the
 * usage site (not embedded here) so we keep the copy reusable.
 *
 * Group by page or feature so tooltips for the same screen sit together.
 * Add `learnMore` URLs alongside copy when there's a deeper write-up.
 */
export interface TooltipEntry {
	text: string;
	learnMore?: string;
}

export type TooltipMap = Record<string, TooltipEntry>;

export const tooltips = {
	home: {
		streak: {
			text: 'Practice on consecutive days to build a streak. Skip a day and it resets to one — your longest streak is preserved in your progress history.'
		},
		todaysKey: {
			text: "Each day rotates to a new key + scale combination. Practicing across all 12 keys is how the canon got built — Coltrane drilled them in every key before recording.",
			learnMore: '/docs/architecture/tonality-system'
		},
		level: {
			text: 'Levels 1–100 reflect your recent accuracy on the current scale. Pass at the level you’re on, and the next attempt nudges harder. Stumble, and it eases off.',
			learnMore: '/docs/architecture/adaptive-difficulty'
		},
		tagged: {
			text: 'Tagged licks are the ones in your practice book — Lick Practice rotates them across all 12 keys. Tag a lick from the Library to add it.'
		},
		bestTempo: {
			text: 'The fastest tempo at which you’ve passed any tagged lick. Lick Practice steps you up by 5 BPM after each pass.'
		},
		sideA: {
			text: 'Side A — Ear Training. The app plays a phrase, you play it back. Pitch and rhythm scored in real time.'
		},
		sideB: {
			text: 'Side B — Lick Practice. Run a tagged lick through every key over a chord progression. Builds muscle memory for soloing.'
		}
	} satisfies TooltipMap,

	practice: {
		playButton: {
			text: 'Click to hear the phrase, then play it back on your instrument. The app keeps looping until you stop.'
		},
		score: {
			text: 'Pitch accuracy weighted 60%, rhythm accuracy weighted 40%. Above 70% counts as a pass — the loop advances to the next phrase. Below, you get one retry.',
			learnMore: '/docs/architecture/scoring-algorithm'
		},
		grades: {
			text: 'Grades: A 90+, B 80–89, C 70–79, D 60–69, F below 60. The number is your weighted score; the grade gives you a quick read.'
		},
		statusText: {
			text: 'Tells you what to do right now. "Listen" while the phrase plays, "Your turn" when it’s your move, "Listening" while the mic captures.'
		},
		settingsDifficulty: {
			text: 'Lock the difficulty level for filtering licks, or let the adaptive system choose. Higher levels expose harder pitch and rhythm content.',
			learnMore: '/docs/architecture/adaptive-difficulty'
		},
		settingsPhraseSource: {
			text: 'Curated licks come from the bundled library. User licks are the ones you recorded yourself or step-entered. Both filter by today’s key.'
		},
		settingsScale: {
			text: 'Override today’s scale to drill a specific tonality. Resets at midnight unless you re-pick.'
		}
	} satisfies TooltipMap,

	library: {
		practiceStar: {
			text: 'Star a lick to tag it for Lick Practice — Side B will rotate it through all 12 keys at increasing tempo.'
		},
		difficultyScale: {
			text: 'Difficulty 1–100 reflects pitch range, rhythmic density, and harmonic complexity. The library filter caps what shows.',
			learnMore: '/docs/architecture/adaptive-difficulty'
		},
		category: {
			text: 'Categories group licks by harmonic context — ii–V–I phrases, dominant lines, blues licks, etc. Filter to focus practice on one shape.'
		},
		community: {
			text: 'Community licks are user-contributed — adopted into your library so you can practice them like the curated ones.'
		}
	} satisfies TooltipMap,

	progress: {
		calendar: {
			text: 'Each square is a day. Brightness reflects practice volume — darker means more sessions.'
		},
		trend: {
			text: 'Daily average accuracy over the rolling window. Watch the slope, not the noise — single sessions vary.'
		},
		pitchComplexity: {
			text: 'How chromatic the licks you’re drilling are. Climbs as your pitch accuracy rises across consecutive sessions.',
			learnMore: '/docs/architecture/adaptive-difficulty'
		},
		rhythmComplexity: {
			text: 'How dense and syncopated the rhythms are. Climbs independently of pitch — you can be advancing in one and not the other.',
			learnMore: '/docs/architecture/adaptive-difficulty'
		},
		rollingWindow: {
			text: 'The adaptive system looks at your last N sessions, not your all-time average. Recent form drives next-phrase difficulty.',
			learnMore: '/docs/architecture/adaptive-difficulty'
		},
		streak: {
			text: 'Consecutive days with at least one practice session. Resets if you skip a day.'
		}
	} satisfies TooltipMap,

	lickPractice: {
		progressionType: {
			text: 'The chord cycle each lick rotates over. ii–V–I is the staple jazz cadence; turnaround adds a vi–ii–V–I cycle; rhythm changes uses the I–vi–ii–V Gershwin pattern.',
			learnMore: '/docs/reference/glossary'
		},
		substitutions: {
			text: 'Adds tritone subs and chromatic approaches to the progression. Same melodic lick, more harmonic challenge.'
		},
		backingStyle: {
			text: 'Swing for straight-ahead jazz, bossa nova for Latin feel, ballad for slow tempos with sustained comping, straight for rock/funk feel.',
			learnMore: '/docs/architecture/audio-pipeline'
		},
		practiceMode: {
			text: 'Continuous: backing track loops while you play freely. Call & response: app plays the lick, you play it back, scored each pass.'
		},
		twelveKeys: {
			text: 'Each tagged lick rotates through all 12 keys over the progression. Mastery means hitting it cleanly in every key, not just the comfortable ones.'
		},
		tempoStep: {
			text: 'Pass a key cleanly and the next attempt bumps tempo +5 BPM. Stumble and it backs off. Tracks per-lick, per-key.'
		}
	} satisfies TooltipMap,

	settings: {
		instrument: {
			text: 'Sets transposition. Notation displays in your written pitch (Bb tenor sees C as written D); audio always plays at concert pitch.'
		},
		bleedFilter: {
			text: 'Filters out audio bleed from the playback feed in your mic input. A/B test toggle — leave on unless you’re debugging detection.'
		},
		highestNote: {
			text: 'Caps how high licks can transpose. Set this to your real high note so the app doesn’t generate phrases above your range.'
		}
	} satisfies TooltipMap,

	jazz: {
		'ii-V-I': {
			text: 'The most common jazz cadence — minor-7 → dominant-7 → major-7. Resolves through the cycle of fifths. If you can solo over ii–V–I in 12 keys, you’ve got the basics.',
			learnMore: '/docs/reference/glossary'
		},
		'rhythm-changes': {
			text: 'A I–vi–ii–V cycle from Gershwin’s "I Got Rhythm." Bebop standard for testing technical command at speed.',
			learnMore: '/docs/reference/glossary'
		},
		turnaround: {
			text: 'A short cadence (often I–vi–ii–V) that loops the form back to the top. Builds harmonic tension that resolves at the next downbeat.',
			learnMore: '/docs/reference/glossary'
		},
		swing: {
			text: 'Subdivides the beat unevenly — long-short-long-short. 0.5 = straight eighths, 0.67 = triplet swing (most common), 0.8 = heavy swing.'
		},
		concertPitch: {
			text: 'Pitch as it sounds, not as your instrument reads it. Bb tenor sees a written C and produces concert Bb. The app stores everything in concert pitch internally.'
		}
	} satisfies TooltipMap
} as const;

export type TooltipKey =
	| keyof typeof tooltips.home
	| keyof typeof tooltips.practice
	| keyof typeof tooltips.library
	| keyof typeof tooltips.progress
	| keyof typeof tooltips.lickPractice
	| keyof typeof tooltips.settings
	| keyof typeof tooltips.jazz;
