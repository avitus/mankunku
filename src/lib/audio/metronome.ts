/**
 * Metronome using Tone.js synth.
 * Accented click on beat 1, lighter click on other beats.
 */

type ToneModule = typeof import('tone');

let tone: ToneModule | null = null;
let clickSynth: InstanceType<ToneModule['Synth']> | null = null;
let gainNode: InstanceType<ToneModule['Gain']> | null = null;
let sequence: InstanceType<ToneModule['Sequence']> | null = null;

async function getTone(): Promise<ToneModule> {
	if (!tone) tone = await import('tone');
	return tone;
}

async function ensureSynth(): Promise<void> {
	if (clickSynth) return;
	const Tone = await getTone();

	gainNode = new Tone.Gain(0.7).toDestination();
	clickSynth = new Tone.Synth({
		oscillator: { type: 'triangle' },
		envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 }
	}).connect(gainNode);
}

/**
 * Schedule metronome clicks for a given time signature and number of bars.
 * Must be called before Transport.start().
 */
export async function scheduleMetronome(
	beatsPerBar: number,
	bars: number
): Promise<void> {
	await ensureSynth();
	const Tone = await getTone();

	// Dispose previous sequence
	if (sequence) {
		sequence.dispose();
		sequence = null;
	}

	const totalBeats = beatsPerBar * bars;
	const beats = Array.from({ length: totalBeats }, (_, i) => i % beatsPerBar);

	sequence = new Tone.Sequence(
		(time, beat) => {
			const freq = beat === 0 ? 1500 : 1000;
			clickSynth!.triggerAttackRelease(freq, '64n', time, beat === 0 ? 0.8 : 0.4);
		},
		beats,
		'4n'
	);
	sequence.start(0);
	sequence.loop = false;
}

/** Set metronome volume (0-1) */
export async function setMetronomeVolume(volume: number): Promise<void> {
	if (!gainNode) {
		await ensureSynth();
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
