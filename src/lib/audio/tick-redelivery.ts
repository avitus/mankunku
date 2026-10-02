/**
 * One transport tick in, one transport tick out.
 *
 * Tone's clock can process ONE tick in two consecutive passes (2026-10-01).
 * Each pass covers [previous end, currentTime + lookAhead), and `TickSource`
 * walks it by adding tick durations; when a pass ends exactly on a tick,
 * accumulated rounding puts the tick inside that pass AND, recomputed from
 * the next pass's start, inside the next one. The render quantum decides
 * where a pass can end, so it recurs at fixed beats: at 240 BPM, beat
 * n ≡ 102 (mod 128) at 44.1 kHz, beat 3 of every bar at 48 kHz. The second
 * delivery carries the same tick number at a time 0 to ~1e-14 s later.
 *
 * Every transport event that is not a once-event then fires twice: a
 * non-looping `Tone.Part`/`Sequence` and `transport.schedule`. That is the
 * melody Part (smplr plays the attack twice, +6 dB), the backing Parts when
 * not looping, the finite metronome and count-in Sequences (a Tone synth
 * throws) and record-a-lick's entrance (`beginActiveRecording` twice orphans
 * its first silence timer, which would cut the take 2 s after the downbeat).
 * `scheduleOnce` and `scheduleRepeat` — and so looping Parts — are immune:
 * every occurrence is a once-event that removes itself when it fires, which
 * covers the turnaround bar, the lick-practice windows and tune practice's
 * freestyle scan.
 *
 * The guard sits where the clock hands ticks to the transport, so it covers
 * every event, present and future, with one rule: a tick is dropped when it
 * repeats the previous tick's NUMBER within SAME_TICK_SECONDS. It drops a
 * repeated tick, never a repeated time inside one: simultaneous events
 * (chord tones, kick + ride) are one tick's fan-out and all still fire.
 *
 * Neither half of the key works alone. Tick numbers legitimately restart
 * after a stop. And the time alone would drop a real tick: when a pass ends
 * on a tick and the transport is then stopped and restarted at that instant
 * (Tone's `stop()` and `start()` both default to `now()`, the pass's end), the
 * restart's tick 0 lands on the same instant as the tick just played. The
 * cost of keying on the number is a transport LOOP: the wrap renumbers the
 * tick, so a re-delivered loop end comes back as loopStart and is let
 * through. At the clock that is indistinguishable from the restart, and the
 * app never loops the transport; the gap is pinned as an expected failure.
 *
 * `_clock` is private to Tone's Transport, so this reaches inside it; the
 * real-Tone tests in tick-redelivery.test.ts pin that shape, and a transport
 * without it is left alone rather than breaking audio.
 */

/** Far above the measured re-delivery gap (≤ ~1e-14 s); a repeat this close is the same tick at the same instant. */
const SAME_TICK_SECONDS = 0.001;

type TickCallback = (time: number, ticks: number) => void;

/** Suppress duplicate clock tick deliveries while preserving simultaneous events and restarts. */
export function guardTickRedelivery(transport: object): void {
	const clock = (transport as { _clock?: { callback?: TickCallback } })._clock;
	const deliver = clock?.callback;
	if (!clock || typeof deliver !== 'function') return;

	let lastTicks = Number.NaN;
	let lastTime = Number.NEGATIVE_INFINITY;
	clock.callback = (time, ticks) => {
		if (ticks === lastTicks && Math.abs(time - lastTime) < SAME_TICK_SECONDS) return;
		lastTicks = ticks;
		lastTime = time;
		deliver(time, ticks);
	};
}
