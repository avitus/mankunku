import type { PitchClass, PhraseCategory, ChordQuality, Phrase } from './music';
import type { Score } from './scoring';
import type { TrickContext, TrickParameters } from './tricks';

export type ChordProgressionType =
	| 'minor-vamp'
	| 'major-vamp'
	| 'dominant-vamp'
	| 'ii-V-I-major'
	| 'ii-V-I-minor'
	| 'ii-V-I-major-long'
	| 'ii-V-I-minor-long'
	| 'turnaround'
	| 'iii-VI-ii-V-I'
	| 'blues';

/**
 * Practice mode:
 * - 'continuous': the app plays the lick once as a demo in the first key,
 *   then the user plays it continuously across all 12 keys back-to-back.
 *   Each user-played key lasts exactly `lengthBars` bars; the beat never
 *   stops. See `buildLickSuperPhrase` for the (1 + 12) × P bar layout.
 * - 'call-response': no upfront demo. For every one of the 12 keys, the
 *   app plays the lick for `lengthBars` bars, then the user responds in
 *   the next `lengthBars` bars. Continuous backing throughout.
 */
export type LickPracticeMode = 'continuous' | 'call-response';

/**
 * Setup-page session-type picker. Drives which configuration block the
 * /lick-practice page renders and which start function the page dispatches
 * to on Start.
 * - 'daily': rotate every progression the user has tagged across all
 *   practice-tagged licks. Calls `startDailyPracticeSession`.
 * - 'focused': pin one progression, rotate its practice-tagged licks.
 *   Calls `startSession`.
 * - 'deep': drill one lick endlessly through the circle of 4ths with
 *   tempo ramp. Calls `startSingleLickSession`.
 * - 'trick': drill one melodic-device variant (trickId + trickParameters)
 *   through its unlocked keys, scored for fluency. Calls `startTrickSession`.
 */
export type LickPracticeSessionType = 'daily' | 'focused' | 'deep' | 'trick';

export interface LickPracticeConfig {
	/** Setup-page picker — see LickPracticeSessionType. */
	sessionType: LickPracticeSessionType;
	progressionType: ChordProgressionType;
	durationMinutes: number;
	/** Practice mode — see LickPracticeMode */
	practiceMode: LickPracticeMode;
	/** Backing track musical style */
	backingStyle: import('./instruments').BackingStyle;
	/**
	 * When true, include licks whose category can substitute over a compatible
	 * chord in the progression (e.g. a minor lick played a semitone above a
	 * dominant chord for altered/diminished color). See `CHORD_SUBSTITUTION_RULES`.
	 */
	enableSubstitutions?: boolean;
	/**
	 * Phrase id of the lick to drill. Only meaningful when
	 * `sessionType === 'deep'`, which cycles this lick endlessly through the
	 * circle of 4ths, drops keys mastered at score ≥ 0.95, and bumps tempo by
	 * `tempoBumpPercent` once all 12 are cleared.
	 */
	singleLickId?: string;
	/**
	 * Percent of the session tempo added each time the whole rotation is
	 * cleared, rounded up to a whole BPM. Default 1 — see
	 * `DEFAULT_TEMPO_BUMP_PERCENT` and `nextCycleTempo` in
	 * `state/lick-practice-rotation.ts`. A percentage rather than a fixed BPM
	 * so the same knob reads the same at 60 BPM and at 200. Governs trick
	 * drills too: they ride the same round loop — and it sizes the focus
	 * ramp's staircase (one step up per clear, `FOCUS_STEP_DOWN_MULTIPLIER`
	 * steps down per sub-floor attempt; see `FocusRamp`).
	 *
	 * The session tempo it ramps is NOT the lick's stored tempo — deep
	 * practice deliberately leaves that where it found it.
	 */
	tempoBumpPercent?: number;
	/**
	 * Trick (melodic device) to drill. Only meaningful when
	 * `sessionType === 'trick'`. `trickId` selects the device from the TRICKS
	 * catalog; together with `trickParameters` it forms the composite variant
	 * key (`trickVariantKey`) that all trick progress is stored under.
	 */
	trickId?: string;
	/** Parameter variant of the selected trick — see `trickId`. */
	trickParameters?: TrickParameters;
}

/**
 * A harmonic substitution rule: licks curated for `sourceCategory` can be
 * transposed over chords of `targetQuality` by shifting the chord root up
 * by `semitoneOffset` semitones.
 *
 * Example: `minor-chord` lick (rooted on `Cm7`) played over a `G7` with
 * `semitoneOffset = 1` becomes `Abm7` over `G7` — the classic "minor a
 * half-step up" device that yields b9/#11/b13 altered sonority.
 */
export interface ChordSubstitutionRule {
	id: string;
	name: string;
	sourceCategory: PhraseCategory;
	targetQuality: ChordQuality;
	semitoneOffset: number;
}

export interface LickPracticeKeyProgress {
	currentTempo: number;
	lastPracticedAt: number;
	passCount: number;
	/**
	 * EWMA of this key's attempt scores (0-1), updated on EVERY scored attempt
	 * — not just passes — so single-lick Deep Practice can rank keys
	 * worst-first and aim the per-cycle demo at the struggling key. Absent on
	 * entries written before the field existed (treated as unknown, which
	 * ranks as "worst" so unfamiliar keys get demoed). Under the per-(lick,key)
	 * LWW cloud merge each device's EWMA only saw its own attempts since the
	 * last sync — an accepted approximation.
	 */
	rollingScore?: number;
}

/** Per-lick, per-key progress stored in localStorage */
export type LickPracticeProgress = Record<string, Partial<Record<PitchClass, LickPracticeKeyProgress>>>;

/**
 * One sample in a lick's practice-progress time series, appended whenever a
 * session bumps tempo or unlocks a key. Powers the per-lick BPM-over-time and
 * keys-unlocked-over-time graphs on the library detail page.
 */
export interface LickProgressPoint {
	/** Wall-clock timestamp (ms) of the sample. Also the per-lick dedupe key. */
	t: number;
	/** Session tempo (BPM) at this point. */
	bpm: number;
	/** Unlocked-key count (1-12) at this point. */
	keys: number;
}

/** Per-lick append-only progress time series, keyed by phraseId. */
export type LickProgressHistory = Record<string, LickProgressPoint[]>;

export interface LickPracticePlanItem {
	phraseId: string;
	phraseName: string;
	phraseNumber: number;
	category: PhraseCategory;
	keys: PitchClass[];
	/**
	 * The chord progression this lick is played under for the duration of its
	 * slot in the plan. Standard sessions stamp every item with the user's
	 * single selection on the setup page. Daily Practice sessions assign each
	 * lick its own least-recently-practiced compatible progression, which is
	 * why this is per-plan-item rather than read from config.
	 */
	progressionType: ChordProgressionType;
	/**
	 * Resolved Phrase captured at plan-build time. Used as a lookup fallback
	 * for `getLickById` so user/licks/community licks survive cache misses (e.g.
	 * the lick was deleted from the local cache mid-session, or the entry
	 * point passed in a Phrase that's not yet in `getAllLicks()`).
	 */
	phrase?: Phrase;
	/**
	 * Item kind. Absent = 'lick' (every pre-tricks plan builder). For a
	 * 'trick' item, `phraseId` IS the composite variant key
	 * (`trickVariantKey(trickId, trickParameters)`) — `getLickById` simply
	 * misses on it and every helper falls back to `phrase`, the generated
	 * example realization.
	 */
	kind?: 'lick' | 'trick';
	/** Trick id from the TRICKS catalog (trick items only). */
	trickId?: string;
	/** Parameter variant being drilled (trick items only). */
	trickParameters?: TrickParameters;
	/**
	 * The C-rooted context `phrase` was generated in (trick items only).
	 * Scoring re-roots it per practiced key: chordRoot/key ← the current key,
	 * tempo/swing ← the live session values.
	 */
	trickContext?: TrickContext;
}

/**
 * Single-lick mode end-of-round summary: which keys cleared at score ≥ 0.95
 * during the round, captured for the session report.
 */
export interface SingleLickRoundEntry {
	round: number;
	tempo: number;
	keys: PitchClass[];
}

/**
 * Single-lick focus ramp — the drill the report's weak-key recommendation
 * launches. The live state is session-local and never persisted — same
 * contract as the rest of the deep-practice tempo ramp; the lick's stored
 * TEMPO is untouched (rolling score, pass count and recency are still
 * recorded per attempt by `recordKeyAttempt`, as in every session). Only its
 * `FocusRampSummary` on the session report outlives the session, logged like
 * any other report field. Pure
 * policy in `state/lick-practice-rotation.ts` (`planFocusRamp`,
 * `resolveRampCycle`).
 *
 * Three phases, one rule each:
 * - `focus` — the rotation is `focusKey` alone; the tempo staircases on it
 *   (clear → up by the bump percent, sub-floor → down by three times it,
 *   in between → hold) until a clear lands at or above `targetTempo`.
 * - `rebuild` — every full clear of the admitted set admits the next queued
 *   key (worst first); tempo held. Ends when the queue drains.
 * - `complete` — ordinary deep practice from here on (clear → bump → refill
 *   from the full unlocked circle).
 */
export interface FocusRamp {
	focusKey: PitchClass;
	/** The lick's saved tempo when the session opened — the focus phase's target. */
	targetTempo: number;
	phase: 'focus' | 'rebuild' | 'complete';
	/** Refill set during rebuild: the focus key plus every key admitted so far, in admission order. */
	admitted: PitchClass[];
	/** Keys not yet admitted, worst-first. */
	queue: PitchClass[];
	/** Round at which the focus key got back up to speed (null until it has). */
	upToSpeedRound: number | null;
	/** Round at which the last key was re-admitted (null until it has). */
	rebuiltRound: number | null;
}

/** What the session report keeps of a focus ramp. */
export interface FocusRampSummary {
	focusKey: PitchClass;
	targetTempo: number;
	/** Lowest session tempo the staircase reached. */
	lowestTempo: number;
	upToSpeedRound: number | null;
	rebuiltRound: number | null;
}

export type LickPracticePhase =
	| 'setup'
	| 'count-in'
	| 'lick-running'
	| 'inter-lick-rest'
	| 'complete';

export interface LickPracticeKeyResult {
	key: PitchClass;
	passed: boolean;
	score: number;
	pitchAccuracy: number;
	rhythmAccuracy: number;
	attempts: number;
	tempo: number;
	/**
	 * IndexedDB recording key for the per-key window. Optional because legacy
	 * archived results may not carry it; new recordings always do.
	 */
	sessionId?: string;
}

// ── Session report (end-of-session summary) ────────────────

export interface LickReport {
	lickId: string;
	lickName: string;
	tempo: number;
	/** Tempo after auto-adjust/increment (null if no change was applied) */
	newTempo: number | null;
	keys: {
		key: PitchClass;
		score: number;
		pitchAccuracy: number;
		rhythmAccuracy: number;
		passed: boolean;
		/**
		 * IndexedDB recording key for the per-key window. Optional for backward
		 * compatibility with sessions persisted before this field was introduced.
		 */
		sessionId?: string;
	}[];
	averageScore: number;
	passedCount: number;
}

export interface SessionReport {
	licks: LickReport[];
	overallAverage: number;
	totalAttempts: number;
	totalPassed: number;
	elapsedMinutes: number;
	/** Single-lick mode only: how many full rounds (12-key cycles) the user completed. */
	roundsCompleted?: number;
	/** Single-lick mode only: tempo at session end (after any tempo bumps). */
	finalTempo?: number;
	/** Single-lick mode only: which keys cleared in each round and at what tempo. */
	keysMasteredByRound?: SingleLickRoundEntry[];
	/** Single-lick mode only: present when the session ran the focus ramp. */
	ramp?: FocusRampSummary;
}
