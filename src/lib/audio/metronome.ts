/**
 * Jazz-style metronome using Tone.js.
 *
 * Ride cymbal on every beat, hi-hat "chick" on 2 & 4.
 * Synthesized from filtered noise bursts — no samples needed.
 */

import { getMasterGain } from './audio-context';

type ToneModule = typeof import('tone');

let tone: ToneModule | null = null;
let rideSynth: InstanceType<ToneModule['NoiseSynth']> | null = null;
let hihatSynth: InstanceType<ToneModule['NoiseSynth']> | null = null;
let kickSynth: InstanceType<ToneModule['MembraneSynth']> | null = null;
let rideFilter: InstanceType<ToneModule['Filter']> | null = null;
let hihatFilter: InstanceType<ToneModule['Filter']> | null = null;
let woodblockSynth: InstanceType<ToneModule['MembraneSynth']> | null = null;
let gainNode: InstanceType<ToneModule['Gain']> | null = null;
let sequence: import('tone').Sequence<number> | null = null;
let countInSequence: import('tone').Sequence<number> | null = null;

async function getTone(): Promise<ToneModule> {
	if (!tone) tone = await import('tone');
	return tone;
}

async function ensureSynths(): Promise<void> {
	if (rideSynth) return;
	const Tone = await getTone();

	// Route metronome through master gain for global volume control
	const master = getMasterGain();
	gainNode = new Tone.Gain(0.6);
	gainNode.connect(master);

	// Ride cymbal: bright filtered noise, longer decay
	rideFilter = new Tone.Filter({ frequency: 8000, type: 'highpass' }).connect(gainNode);
	rideSynth = new Tone.NoiseSynth({
		noise: { type: 'white' },
		envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.08 }
	}).connect(rideFilter);

	// Hi-hat chick: tight filtered noise, very short
	hihatFilter = new Tone.Filter({ frequency: 6000, type: 'highpass' }).connect(gainNode);
	hihatSynth = new Tone.NoiseSynth({
		noise: { type: 'pink' },
		envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 }
	}).connect(hihatFilter);

	// Kick drum on beat 1: short membrane thump to mark the downbeat
	kickSynth = new Tone.MembraneSynth({
		pitchDecay: 0.04,
		octaves: 6,
		envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 }
	}).connect(gainNode);

	// Count-in "woodblock": a high, dead-short membrane tock. Deliberately
	// nothing like the kit above — the switch from this to ride/kick/hi-hat
	// is the audible "your entrance" cue in record-a-lick.
	woodblockSynth = new Tone.MembraneSynth({
		pitchDecay: 0.008,
		octaves: 2,
		envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 }
	}).connect(gainNode);
}

/**
 * Pre-create metronome synths so the audio graph is stable before the
 * first beat needs to fire. Call this during instrument loading, well
 * before the first playPhrase().
 */
export async function warmUpMetronome(): Promise<void> {
	await ensureSynths();
}

/**
 * Schedule a jazz metronome pattern for a given number of bars.
 * Ride on every beat, hi-hat chick on 2 & 4.
 * Must be called before Transport.start().
 *
 * @param beatsPerBar - Beats per bar (typically 4)
 * @param bars - Number of bars (null = loop indefinitely)
 * @param startAt - Transport time of the first beat. Prefer tick notation
 *   (e.g. `` `${8 * transport.PPQ}i` ``) over '2m': bar-based times convert
 *   through the STICKY global Transport.timeSignature, which a prior
 *   playback in another meter may have left at 3.
 */
export async function scheduleMetronome(
	beatsPerBar: number,
	bars: number | null,
	startAt: string | number = 0
): Promise<void> {
	await ensureSynths();
	const Tone = await getTone();

	// Dispose previous sequence
	if (sequence) {
		sequence.dispose();
		sequence = null;
	}

	const beatsInPattern = beatsPerBar;
	const pattern = Array.from({ length: beatsInPattern }, (_, i) => i);

	if (bars !== null) {
		// Finite: build a flat array of all beats
		const totalBeats = beatsPerBar * bars;
		const allBeats = Array.from({ length: totalBeats }, (_, i) => i % beatsPerBar);

		sequence = new Tone.Sequence(
			(time, beat) => {
				if (beat === 0) {
					// Kick drum on the downbeat
					kickSynth!.triggerAttackRelease('C1', '16n', time, 0.7);
				} else {
					// Ride cymbal on beats 2, 3, 4
					rideSynth!.triggerAttackRelease('16n', time, 0.4);
				}
				// Hi-hat chick on 2 & 4
				if (beat === 1 || beat === 3) {
					hihatSynth!.triggerAttackRelease('32n', time, 0.5);
				}
			},
			allBeats,
			'4n'
		);
		sequence.start(startAt);
		sequence.loop = false;
	} else {
		// Infinite loop for recording phase
		sequence = new Tone.Sequence(
			(time, beat) => {
				if (beat === 0) {
					// Kick drum on the downbeat
					kickSynth!.triggerAttackRelease('C1', '16n', time, 0.7);
				} else {
					// Ride cymbal on beats 2, 3, 4
					rideSynth!.triggerAttackRelease('16n', time, 0.4);
				}
				// Hi-hat chick on 2 & 4
				if (beat === 1 || beat === 3) {
					hihatSynth!.triggerAttackRelease('32n', time, 0.5);
				}
			},
			pattern,
			'4n'
		);
		sequence.start(startAt);
		sequence.loop = true;
	}
}

/**
 * Schedule a finite run of count-in clicks from transport 0: woodblock tocks,
 * downbeats accented. A distinct voice on purpose — pair with
 * `scheduleMetronome(beatsPerBar, bars, '<countInBars>m')` so the kit enters
 * exactly where the tocks stop and the texture change marks the entrance.
 * Must be called before Transport.start(). Clicks stay on the same quarter
 * grid as the kit, so `getMetronomeBleedOnsets` needs no special casing.
 */
export async function scheduleCountInClicks(beatsPerBar: number, bars: number): Promise<void> {
	await ensureSynths();
	const Tone = await getTone();

	if (countInSequence) {
		countInSequence.dispose();
		countInSequence = null;
	}

	const totalBeats = beatsPerBar * bars;
	const allBeats = Array.from({ length: totalBeats }, (_: unknown, i: number) => i % beatsPerBar);

	countInSequence = new Tone.Sequence(
		(time: number, beat: number) => {
			woodblockSynth!.triggerAttackRelease(beat === 0 ? 'A5' : 'E5', '32n', time, beat === 0 ? 0.9 : 0.6);
		},
		allBeats,
		'4n'
	);
	countInSequence.start(0);
	countInSequence.loop = false;
}

/** Set metronome volume (0-1) */
export async function setMetronomeVolume(volume: number): Promise<void> {
	if (!gainNode) {
		await ensureSynths();
	}
	gainNode!.gain.value = Math.max(0, Math.min(1, volume));
}

/** Stop and dispose the metronome sequences (kit and count-in) */
export function disposeMetronome(): void {
	if (sequence) {
		sequence.dispose();
		sequence = null;
	}
	if (countInSequence) {
		countInSequence.dispose();
		countInSequence = null;
	}
}
