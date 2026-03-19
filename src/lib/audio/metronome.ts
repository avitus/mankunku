/**
 * Jazz-style metronome using Tone.js.
 *
 * Ride cymbal on every beat, hi-hat "chick" on 2 & 4.
 * Synthesized from filtered noise bursts — no samples needed.
 */

type ToneModule = typeof import('tone');

let tone: ToneModule | null = null;
let rideSynth: InstanceType<ToneModule['NoiseSynth']> | null = null;
let hihatSynth: InstanceType<ToneModule['NoiseSynth']> | null = null;
let rideFilter: InstanceType<ToneModule['Filter']> | null = null;
let hihatFilter: InstanceType<ToneModule['Filter']> | null = null;
let gainNode: InstanceType<ToneModule['Gain']> | null = null;
let sequence: InstanceType<ToneModule['Sequence']> | null = null;

async function getTone(): Promise<ToneModule> {
	if (!tone) tone = await import('tone');
	return tone;
}

async function ensureSynths(): Promise<void> {
	if (rideSynth) return;
	const Tone = await getTone();

	gainNode = new Tone.Gain(0.6).toDestination();

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
				// Ride on every beat — accent beat 1
				rideSynth!.triggerAttackRelease('16n', time, beat === 0 ? 0.7 : 0.4);
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
				rideSynth!.triggerAttackRelease('16n', time, beat === 0 ? 0.7 : 0.4);
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
