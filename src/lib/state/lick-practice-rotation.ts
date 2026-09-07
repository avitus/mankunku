/**
 * Deep-practice cycle policy — pure, Node-testable helpers behind the
 * continuous single-lick flow.
 *
 * A deep-practice session runs the unlocked keys as an endless stream of
 * cycles with a one-bar band turnaround between them. Two policies shape
 * each cycle:
 *
 * - The rotation is sorted worst-first (`sortKeysWorstFirst`) so `keys[0]`
 *   is the key the user struggles with most. The super-phrase demo already
 *   plays `keys[0]`, and the user answers in that key immediately after —
 *   call-and-response on exactly the key that needs ear work.
 * - The demo itself is conditional (`shouldDemoHeadKey`): it plays only
 *   while the head key's rolling score is below proficient, so strong
 *   cycles run back-to-back with no listening interlude — and never on a
 *   refill cycle, a rotation rebuilt after a full clear (the state module's
 *   `advanceSingleLickRound` applies that half of the rule): the user just
 *   played every key in it, and a rolling score that lags the clear is no
 *   reason to replay the line.
 * - The sheet music is conditional too (`shouldRevealNotation`): the
 *   session shows notation only for the key the player is LEARNING — the
 *   most recently unlocked one (`newestUnlockedKey`) — while that key's
 *   rolling score is below the floor, never for an earlier key (memorised by
 *   the time the next one unlocks), never once all twelve are unlocked, and
 *   never for a key that has not been attempted yet — the first pass is
 *   always by ear. A revealed key runs `LEAD_SHEET_PASSES` windows in a row
 *   so the line can be memorised from the page, and — unless it opens a
 *   cycle that demos, where the demo already does this — a
 *   `LEAD_SHEET_PAUSE_BARS` reading pause precedes its first pass: the band
 *   vamps a ii-V into the key while the sheet steps in, so the switch from
 *   playing by memory to reading is heralded, not sprung. Same rule in
 *   every session type, not just deep practice.
 *
 * The timing helpers keep the boundary robust: the cycle boundary fires at
 * the last key's close tick, leaving exactly the turnaround bar of
 * scheduling lead — `resolveNextCycleStart` stretches the turnaround by
 * whole bars when a late callback (stalled main thread) has eaten that
 * lead, `planCycleWindows` computes the recording windows for any
 * demo/pause/key layout so the scheduler stays declarative, and
 * `cyclePositionAt` reads the display's position (row, pass, beat) back off
 * that same plan, so the stack and the chart can never disagree with the
 * microphone about where in the cycle they are.
 *
 * The tempo helpers (`deepPracticeStartTempo`, `nextCycleTempo`) shape the
 * ramp: a session eases in below the lick's stored tempo and climbs back by
 * a percentage of wherever it currently sits, so the same rule reads the
 * same at 60 BPM and at 200.
 *
 * The focus ramp (`planFocusRamp`, `resolveRampCycle`) is the drill the
 * report's weak-key recommendation launches. Instead of the whole unlocked
 * circle it opens on the failing key ALONE, `focusStartTempo` under the
 * lick's saved tempo, and staircases that one key (clear → up, sub-floor →
 * `focusStepDownTempo`, in between → hold) until a clear lands back at the
 * saved tempo — "up to speed". Then it re-admits the other keys one per
 * cleared rotation, worst first, at a held tempo, and once the full set is
 * back hands over to the ordinary clear → bump → refill rule. One rule per
 * phase: focus earns tempo, rebuild earns keys, a full rotation earns tempo
 * again. It is the unlock ladder in miniature, with expertise standing in
 * for circle-of-fifths adjacency as the admission order.
 */

import type { PitchClass } from '$lib/types/music';
import type { FocusRamp } from '$lib/types/lick-practice';
import { MAX_UNLOCKED_KEYS, planUnlockedKeys } from '$lib/music/key-ordering';
import {
	KEY_FLOOR_THRESHOLD,
	KEY_PROFICIENT_THRESHOLD,
	clampTempo
} from '$lib/persistence/lick-practice-store';

/**
 * Order keys ascending by rolling score, never-practiced (undefined) first.
 * Stable, non-mutating: keys without data anywhere keep their incoming
 * circle-of-fourths order, and ties preserve it too.
 */
export function sortKeysWorstFirst(
	keys: readonly PitchClass[],
	rollingFor: (key: PitchClass) => number | undefined
): PitchClass[] {
	return [...keys].sort((a, b) => {
		const ra = rollingFor(a) ?? -1;
		const rb = rollingFor(b) ?? -1;
		return ra - rb;
	});
}

/**
 * Should the next cycle open with the app playing the lick in the head
 * (worst) key? Yes while that key is unknown or below proficient — the
 * user still needs the reference; no once it clears the bar, so proficient
 * cycles flow without stoppage. This is the score half of the rule; the
 * caller vetoes the demo outright on a refill cycle, whatever the score.
 */
export function shouldDemoHeadKey(
	headRolling: number | undefined,
	threshold: number = KEY_PROFICIENT_THRESHOLD
): boolean {
	return headRolling === undefined || headRolling < threshold;
}

/**
 * Consecutive play windows a revealed key gets in one cycle: enough to read
 * the line, read it again, and then play it from memory.
 */
export const LEAD_SHEET_PASSES = 3;

/**
 * Bars of band-only pause before a revealed key's first pass, when that key
 * does not open the cycle. Playing from memory and reading are different
 * modes, and a player needs a beat to change modes: the previous key's
 * window closes, its score lands, the sheet steps into place and lights,
 * the band vamps a ii-V into the new key, and the tab counts the entrance
 * in. Two bars is the app's established shape for an entrance the player
 * must reorient for (the inter-lick rest: one bar to see the score, one cue
 * bar; record-a-lick's two-bar count-in) — the ONE-bar turnaround joins
 * keys played in the same mode. A revealed key that opens the cycle needs
 * none: the demo of that key, with the sheet already up, is its herald.
 */
export const LEAD_SHEET_PAUSE_BARS = 2;

/**
 * The key a lick's player is currently learning: the most recently unlocked
 * one. Derivable with no timestamp because the unlock state is a single
 * per-lick count and the ramp (`planUnlockedKeys`) is a pure function of the
 * entry key — the newest key is simply the ramp's last entry. Null once every
 * key is unlocked: nothing is "newest" any more.
 */
export function newestUnlockedKey(entryKey: PitchClass, unlockedCount: number): PitchClass | null {
	if (unlockedCount >= MAX_UNLOCKED_KEYS) return null;
	const ramp = planUnlockedKeys(entryKey, unlockedCount);
	return ramp[ramp.length - 1] ?? null;
}

export interface NotationRevealInput {
	/** The key of the row being decided. */
	key: PitchClass;
	/** The lick's own key — the origin of its unlock ramp. */
	entryKey: PitchClass;
	/** Keys unlocked for the lick so far (1–12). */
	unlockedCount: number;
	/** The key's persisted rolling score; undefined = never attempted here. */
	rolling: number | undefined;
}

/**
 * Should the session show the sheet music for this key? Only for the key
 * being learned — the newest unlocked one — and only while its rolling score
 * is below the floor: the player is failing it on balance, and reading the
 * line beats another blind miss. Earlier keys never reveal (they were learned
 * before the next one unlocked), and nothing reveals at twelve of twelve.
 * The one deliberate difference from `shouldDemoHeadKey`: an UNKNOWN score
 * never reveals, because the first attempt in a key is always by ear. The
 * rule is the same in both directions, so the sheet withdraws on its own
 * once the rolling score recovers over the floor.
 */
export function shouldRevealNotation(
	input: NotationRevealInput,
	floor: number = KEY_FLOOR_THRESHOLD
): boolean {
	if (input.key !== newestUnlockedKey(input.entryKey, input.unlockedCount)) return false;
	return input.rolling !== undefined && input.rolling < floor;
}

/**
 * How far below the lick's stored tempo a deep-practice session opens.
 *
 * Deep practice is most often entered from the report's recommendation, on
 * the lick that just graded worst. Dropping straight in at the tempo the
 * lick failed at repeats the failure; a small step down makes the first
 * cycle a re-entry rather than a cold sprint, and `nextCycleTempo` earns the
 * difference back over the first couple of clears.
 */
export const DEEP_PRACTICE_START_DISCOUNT = 0.02;

/** Percent of the current tempo added each time the whole rotation clears. */
export const DEFAULT_TEMPO_BUMP_PERCENT = 1;

/**
 * Opening tempo for a deep-practice session, given the lick's stored tempo.
 *
 * The `persisted - 1` arm guarantees a real step down: at low tempos 2%
 * rounds back to the input (60 → 59 is fine, but 50 → 50 would silently
 * disable the ease-in), and a discount that doesn't move is worse than none
 * because it reads as working.
 */
export function deepPracticeStartTempo(persisted: number): number {
	const eased = Math.round(persisted * (1 - DEEP_PRACTICE_START_DISCOUNT));
	return clampTempo(Math.min(persisted - 1, eased));
}

/**
 * Tempo for the next cycle after the whole rotation cleared.
 *
 * Rounded UP, because 1% of anything under 100 BPM floors to zero — a bump
 * that never fires would strand every lick below 100 at its opening tempo
 * forever. The cost is that a 1% rule is really "1%, or 1 BPM, whichever is
 * more", which at 60 BPM is closer to 1.7%.
 */
export function nextCycleTempo(current: number, percent: number): number {
	return clampTempo(current + Math.ceil(current * (percent / 100)));
}

// ── Focus ramp ─────────────────────────────────────────────

/**
 * How far under the lick's saved tempo a focus ramp opens. Ten percent is
 * the same dip a key unlock applies (`tempoAfterKeyUnlock`): a key that just
 * failed is, for drilling purposes, a new key — it resets your headroom. The
 * 2% deep-practice ease-in is a courtesy for a key that nearly made it; it
 * is meaningless for one that came in at 41%.
 */
export const FOCUS_START_DISCOUNT = 0.1;

/**
 * A sub-floor attempt in the focus phase steps the tempo down by this many
 * times the bump percent. Mirrors the standard session's −3/+1 asymmetry
 * (`computeAutoTempoAdjustment`): one failure costs three clears, so the
 * staircase settles quickly on a tempo the key can actually be played at
 * and climbs back only as fast as it is earned.
 */
export const FOCUS_STEP_DOWN_MULTIPLIER = 3;

/**
 * Opening tempo for a focus ramp, given the lick's saved tempo. Same ≥ 1 BPM
 * guarantee as `deepPracticeStartTempo`, clamped at MIN_TEMPO.
 */
export function focusStartTempo(persisted: number): number {
	const eased = Math.round(persisted * (1 - FOCUS_START_DISCOUNT));
	return clampTempo(Math.min(persisted - 1, eased));
}

/**
 * Tempo after a sub-floor attempt in the focus phase. Rounded UP like
 * `nextCycleTempo`, for the same reason — a step that rounds to zero would
 * read as working while doing nothing — and clamped at MIN_TEMPO.
 */
export function focusStepDownTempo(current: number, percent: number): number {
	return clampTempo(
		current - Math.ceil(current * ((percent * FOCUS_STEP_DOWN_MULTIPLIER) / 100))
	);
}

/**
 * Build the opening ramp state: the focus key alone, every other unlocked
 * key queued worst-first (never-practiced first, via `sortKeysWorstFirst`).
 * Returns null when the focus key is not in the unlocked circle — the caller
 * falls back to an ordinary full-rotation start rather than drilling a key
 * the lick hasn't earned.
 */
export function planFocusRamp(
	circle: readonly PitchClass[],
	focusKey: PitchClass,
	targetTempo: number,
	rollingFor: (key: PitchClass) => number | undefined
): FocusRamp | null {
	if (!circle.includes(focusKey)) return null;
	return {
		focusKey,
		targetTempo,
		phase: 'focus',
		admitted: [focusKey],
		queue: sortKeysWorstFirst(
			circle.filter((k) => k !== focusKey),
			rollingFor
		),
		upToSpeedRound: null,
		rebuiltRound: null
	};
}

export interface RampCycleInput {
	ramp: FocusRamp;
	/** Keys left in the rotation after this round's masteries dropped out. */
	survivors: readonly PitchClass[];
	tempo: number;
	bumpPercent: number;
	/** The focus key's score this round; only the focus phase reads it. */
	focusScore: number | undefined;
	/** The 1-based round just completed — stamps the milestones. */
	round: number;
}

export interface RampCycleOutput {
	ramp: FocusRamp;
	/** Next cycle's rotation, unsorted — the caller applies worst-first. */
	rotation: PitchClass[];
	tempo: number;
}

/**
 * One cycle boundary of a focus ramp. Pure and non-mutating: returns the
 * next ramp state, the next rotation and the next tempo.
 *
 * - focus, cleared: step up; at or above the target that clear ends focus
 *   and admits the first queued key in the same step (or completes the ramp
 *   outright when nothing is queued). The tempo is clamped to the target on
 *   that clear — a 5% knob from 99 would otherwise open rebuild at 104, and
 *   "held at the saved tempo" is the promise.
 * - focus, not cleared: step down on a sub-floor score, hold otherwise.
 * - rebuild, cleared: admit the next queued key; the last admission
 *   completes the ramp. Tempo held.
 * - rebuild, not cleared: survivors keep cycling. Tempo held.
 * - complete: untouched — the caller runs the ordinary rule.
 */
export function resolveRampCycle(input: RampCycleInput): RampCycleOutput {
	const { ramp, survivors, bumpPercent, focusScore, round } = input;
	const cleared = survivors.length === 0;
	let tempo = input.tempo;

	if (ramp.phase === 'focus') {
		if (!cleared) {
			if (focusScore !== undefined && focusScore < KEY_FLOOR_THRESHOLD) {
				tempo = focusStepDownTempo(tempo, bumpPercent);
			}
			return { ramp: cloneRamp(ramp), rotation: [ramp.focusKey], tempo };
		}
		tempo = nextCycleTempo(tempo, bumpPercent);
		if (tempo < ramp.targetTempo) {
			return { ramp: cloneRamp(ramp), rotation: [ramp.focusKey], tempo };
		}
		// Up to speed — land exactly on the saved tempo (a bump rounds/overshoots;
		// rebuild holds at the target, never above it). Leave focus and admit the
		// first queued key now: the user just cleared at speed; there is nothing
		// left to prove alone.
		tempo = ramp.targetTempo;
		return {
			...admitNext({ ...cloneRamp(ramp), phase: 'rebuild', upToSpeedRound: round }, round),
			tempo
		};
	}

	if (ramp.phase === 'rebuild') {
		if (!cleared) return { ramp: cloneRamp(ramp), rotation: [...survivors], tempo };
		return { ...admitNext(cloneRamp(ramp), round), tempo };
	}

	return { ramp: cloneRamp(ramp), rotation: [...survivors], tempo };
}

function cloneRamp(ramp: FocusRamp): FocusRamp {
	return { ...ramp, admitted: [...ramp.admitted], queue: [...ramp.queue] };
}

/** Move the head of the queue into the admitted set; an empty queue completes the ramp. */
function admitNext(ramp: FocusRamp, round: number): { ramp: FocusRamp; rotation: PitchClass[] } {
	const [next, ...queue] = ramp.queue;
	const admitted = next === undefined ? [...ramp.admitted] : [...ramp.admitted, next];
	const complete = queue.length === 0;
	return {
		ramp: {
			...ramp,
			admitted,
			queue,
			phase: complete ? 'complete' : 'rebuild',
			rebuiltRound: complete ? round : ramp.rebuiltRound
		},
		rotation: [...admitted]
	};
}

/**
 * Resolve where the next cycle's audio may safely start. Ideally that is
 * `idealStartTick` (one turnaround bar after the cycle end), but if the
 * boundary callback fired late and fewer than `minLeadTicks` remain before
 * that tick, push the start forward by whole bars — the turnaround
 * stretches, the music stays on the bar grid, and scheduling never lands
 * in the past.
 */
export function resolveNextCycleStart(
	idealStartTick: number,
	currentTick: number,
	ticksPerBar: number,
	minLeadTicks: number
): number {
	let start = idealStartTick;
	while (start - currentTick < minLeadTicks) {
		start += ticksPerBar;
	}
	return start;
}

export interface CycleWindowPlan {
	/** Per-window recording-window open ticks, in playing order. */
	opens: number[];
	/** Per-window recording-window close ticks, in playing order. */
	closes: number[];
	/** Rotation slot (index into the key list) each window belongs to. */
	keyIndex: number[];
	/** True on a key's last window — the attempt of record; earlier passes are rehearsals. */
	finalPass: boolean[];
	/**
	 * Ticks of band-only reading pause laid immediately before this window's
	 * slot — non-zero only on a revealed key's FIRST window. The phase
	 * timeline reads it as a `read` block and the display holds the row
	 * current, unplayed, through it.
	 */
	pauseTicks: number[];
	/** Tick where the last window closes — the cycle boundary. */
	cycleEndTick: number;
}

/**
 * Lay out a cycle's recording windows: an optional demo block of
 * `demoBars`, then per key an optional pause of `pauses[i]` bars followed by
 * one window of `keyBars` per pass, back to back — every key gets one pass
 * unless `passes` says otherwise (a revealed key gets `LEAD_SHEET_PASSES`,
 * abutting, in its own rotation slot, behind its `LEAD_SHEET_PAUSE_BARS`
 * pause). `userBarsOffsetTicks` delays each window's open within its slot
 * (call-response mode, where the app plays the first half). Where the
 * pauses go is the caller's policy (`getKeyPauses`); this only lays them out.
 */
export function planCycleWindows(args: {
	audioStartTick: number;
	demoBars: number;
	keyBars: number;
	ticksPerBar: number;
	keyCount: number;
	/** Windows per key, in rotation order; defaults to one each. Must match `keyCount`. */
	passes?: readonly number[];
	/** Bars of pause before each key's first window; defaults to none. Must match `keyCount`. */
	pauses?: readonly number[];
	userBarsOffsetTicks: number;
}): CycleWindowPlan {
	const { audioStartTick, demoBars, keyBars, ticksPerBar, keyCount, userBarsOffsetTicks } = args;
	const passes = args.passes ?? Array.from({ length: keyCount }, () => 1);
	if (passes.length !== keyCount) {
		throw new Error(`planCycleWindows: ${passes.length} pass counts for ${keyCount} keys`);
	}
	const pauses = args.pauses ?? Array.from({ length: keyCount }, () => 0);
	if (pauses.length !== keyCount) {
		throw new Error(`planCycleWindows: ${pauses.length} pause counts for ${keyCount} keys`);
	}

	const opens: number[] = [];
	const closes: number[] = [];
	const keyIndex: number[] = [];
	const finalPass: boolean[] = [];
	const pauseTicks: number[] = [];
	// Bars laid out so far, from the audio start: the demo, then each key's
	// pause and passes in turn.
	let barCursor = demoBars;
	for (let i = 0; i < keyCount; i++) {
		const pause = Math.max(0, pauses[i]);
		barCursor += pause;
		const count = Math.max(1, passes[i]);
		for (let pass = 0; pass < count; pass++) {
			const slotStartTick = audioStartTick + barCursor * ticksPerBar;
			opens.push(slotStartTick + userBarsOffsetTicks);
			closes.push(slotStartTick + keyBars * ticksPerBar);
			keyIndex.push(i);
			finalPass.push(pass === count - 1);
			pauseTicks.push(pass === 0 ? pause * ticksPerBar : 0);
			barCursor += keyBars;
		}
	}

	return {
		opens,
		closes,
		keyIndex,
		finalPass,
		pauseTicks,
		cycleEndTick: audioStartTick + barCursor * ticksPerBar
	};
}

/** Where in its cycle the transport is, for the display. */
export interface CyclePosition {
	/**
	 * `lead` — before the audio (count-in, turnaround, inter-lick rest);
	 * `demo` — the app playing the head key; `pause` — a revealed key's
	 * reading pause; `play` — inside a key's slot (a call-response slot
	 * includes the app's half); `done` — at or past the cycle end.
	 */
	segment: 'lead' | 'demo' | 'pause' | 'play' | 'done';
	/**
	 * Position in KEY units: the integer part is the rotation slot whose row
	 * is current, the fraction its progress through that key's passes (a
	 * three-pass key runs 0 → 1 across all three). Exactly the integer through
	 * a pause — the row is up, nothing has been played. Clamped to
	 * `[0, keyCount]`; the key count means "past the last key".
	 */
	keyFraction: number;
	/**
	 * Beat within the sounding chart loop (`0 ≤ beat < loopBeats`), restarting
	 * at each slot start — the chord chart's lit cell and the lead sheet's bar
	 * marker read it. −1 through a pause and past the cycle end (nothing to
	 * mark); 0 before the audio starts (the head row waits on its downbeat).
	 */
	beat: number;
}

export interface CyclePositionArgs {
	/** Tick where the cycle's audio begins (after any count-in / turnaround). */
	audioStartTick: number;
	demoBars: number;
	/** Bars per key slot (the whole slot in call-response — call + answer). */
	keyBars: number;
	ticksPerBar: number;
	ticksPerBeat: number;
	/**
	 * Beats the chord chart loops over: the lick's bars × beats per bar. In
	 * call-response that is HALF the slot, so the call and the answer animate
	 * the chart identically.
	 */
	loopBeats: number;
	windows: CycleWindowPlan;
}

/**
 * Read the display's position off the window plan: which key's row is
 * current, how far through its passes it is, and which beat of the chart to
 * light. The same plan the recorder is scheduled against, so the stack, the
 * chart and the microphone can never disagree — and the one place the
 * pause is understood, so a pause of any length keeps every later slot's
 * beat aligned to its own downbeat (a global modulo over the cycle would
 * drift by the pause).
 */
export function cyclePositionAt(tick: number, args: CyclePositionArgs): CyclePosition {
	const { audioStartTick, demoBars, keyBars, ticksPerBar, ticksPerBeat, loopBeats, windows } = args;
	const beatAt = (ticksIntoSlot: number): number =>
		loopBeats > 0 && ticksPerBeat > 0 ? (ticksIntoSlot / ticksPerBeat) % loopBeats : 0;
	const keyCount = windows.keyIndex.length > 0 ? windows.keyIndex[windows.keyIndex.length - 1] + 1 : 0;

	if (tick < audioStartTick) return { segment: 'lead', keyFraction: 0, beat: 0 };
	const demoEndTick = audioStartTick + demoBars * ticksPerBar;
	if (tick < demoEndTick) {
		return { segment: 'demo', keyFraction: 0, beat: beatAt(tick - audioStartTick) };
	}

	const keyTicks = keyBars * ticksPerBar;
	for (let w = 0; w < windows.closes.length; w++) {
		const closeTick = windows.closes[w];
		if (tick >= closeTick) continue;
		const key = windows.keyIndex[w];
		const slotStartTick = closeTick - keyTicks;
		if (tick < slotStartTick) return { segment: 'pause', keyFraction: key, beat: -1 };
		// This key's passes: the windows sharing its slot index, in order.
		let firstWindow = w;
		while (firstWindow > 0 && windows.keyIndex[firstWindow - 1] === key) firstWindow--;
		let passes = 0;
		for (let k = firstWindow; k < windows.keyIndex.length && windows.keyIndex[k] === key; k++) passes++;
		const pass = w - firstWindow;
		const within = keyTicks > 0 ? (tick - slotStartTick) / keyTicks : 0;
		return {
			segment: 'play',
			keyFraction: key + (pass + within) / passes,
			beat: beatAt(tick - slotStartTick)
		};
	}

	return { segment: 'done', keyFraction: keyCount, beat: -1 };
}
