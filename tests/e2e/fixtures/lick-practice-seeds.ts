/**
 * Full lick-practice session flow.
 *
 * Seeds one practice-tagged lick (`practice` + `prog:ii-V-I-major` in the
 * user-lick-tags blob), starts a Daily Practice session from the setup page,
 * and lets the engine run a complete round on its own: demo cycle, then one
 * recorded key window at the seeded 180 BPM. The lick plans a single
 * unlocked key, so when that window closes and scores, the plan is
 * exhausted and the Session Report renders without any further interaction —
 * reaching it proves the whole round loop (playback → recording → scoring →
 * advance → report) actually ran.
 *
 * The mic is the mocked stream from fixtures/audio.ts. What the pitch
 * detector hears is irrelevant to the flow: the scoring pipeline records a
 * result for every closed window (silence scores 0), so the report
 * deterministically shows one attempted key. Assertions therefore pin
 * structure (attempt counts, BPM readouts, percentage chips), never the
 * score's value.
 *
 * The specs that share it: lick-practice-session (setup and failures),
 * -daily-report, -focus-drill, -deep and -lead-sheet. They were one file
 * until 2026-10-20, whose 11 minutes of JUnit time ran on a single CI node.
 */

/**
 * Stored per-key progress pinning the session tempo at 180 BPM. These tests
 * ran at the new-lick default of 60 BPM for months and were the two slowest
 * specs in the entire suite (115s/108s on CI WebKit) — the flow is real-time
 * transport playback, so bar time IS test time and 180 cuts it 3×. The
 * 60-BPM default itself is unit-tested (resolveLickTempo); what these tests
 * pin is the round loop, which is tempo-independent. Only key C exists and
 * no unlock counts are seeded, so the plan still holds exactly one key.
 */
export const FAST_TEMPO = 180;
export const SEEDED_PROGRESS = {
	'lick-practice-progress': {
		'e2e-user-lick-bebop': {
			C: { currentTempo: FAST_TEMPO, lastPracticedAt: 1754000000000, passCount: 0 }
		}
	}
};

/**
 * The same seed with a sub-floor rolling score on C — a key the player has
 * been failing. C is the lick's only unlocked key, hence the one being
 * learned, so the session engraves its row as a lead sheet while the rolling
 * score is under the floor (`shouldRevealNotation` → `PlannedKey.reveal`) and
 * runs it for three passes. Recommendations read separate session history,
 * so a low rolling score alone cannot manufacture persistent weakness.
 */
export const SUB_FLOOR_PROGRESS = {
	'lick-practice-progress': {
		'e2e-user-lick-bebop': {
			C: {
				currentTempo: FAST_TEMPO,
				lastPracticedAt: 1754000000000,
				passCount: 0,
				rollingScore: 0.5
			}
		}
	}
};

/**
 * Two unlocked keys — C (the entry key) and Bb (the newest: the e2e player
 * is a tenor, and concert Bb is their written C, the easiest signature on
 * the `planUnlockedKeys` ramp) — with Bb under the floor, so the Daily stack
 * is a chord row over a lead-sheet row: `[C, Bb]`, Bb revealed. The unlock
 * count is a separate store (`lick-unlock-count`), so C's pass count is
 * decorative.
 */
export const LEAD_AHEAD_PROGRESS = {
	'lick-practice-progress': {
		'e2e-user-lick-bebop': {
			C: { currentTempo: FAST_TEMPO, lastPracticedAt: 1754000000000, passCount: 3 },
			Bb: {
				currentTempo: FAST_TEMPO,
				lastPracticedAt: 1754000000000,
				passCount: 0,
				rollingScore: 0.5
			}
		}
	},
	'lick-unlock-count': { 'e2e-user-lick-bebop': 2 }
};
