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
let gainNode: InstanceType<ToneModule['Gain']> | null = null;
let sequence: import('tone').Sequence<number> | null = null;

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
 */
export async function scheduleMetronome(
	beatsPerBar: number,
	bars: number | null
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
		sequence.start(0);
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
		sequence.start(0);
		sequence.loop = true;
	}
}

/** Set metronome volume (0-1) */
export async function setMetronomeVolume(volume: number): Promise<void> {
	if (!gainNode) {
		await ensureSynths();
	}
	gainNode!.gain.value = Math.max(0, Math.min(1, volume));
}

/** Stop and dispose the metronome sequence */
export function disposeMetronome(): void {
	if (sequence) {
		sequence.dispose();
		sequence = null;
	}
}
