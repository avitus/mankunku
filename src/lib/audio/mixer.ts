import { createOutputProtection } from './output-protection';
import { MIXER_DEFAULTS, clampGain, type MixerLevels } from './mixer-policy';

export interface AudioMixer {
	program: GainNode;
	melody: GainNode;
	click: GainNode;
	output: GainNode;
	master: GainNode;
	setLevels(levels: MixerLevels): void;
	dispose(): void;
}

/** Program feeds recording; replay joins only at the listening output. */
export function createMixer(context: BaseAudioContext, destination: AudioNode, levels: MixerLevels = MIXER_DEFAULTS): AudioMixer {
	const program = context.createGain();
	const melody = context.createGain();
	const click = context.createGain();
	const output = context.createGain();
	const master = context.createGain();
	const protection = createOutputProtection(context);
	melody.connect(program);
	click.connect(program);
	program.connect(output);
	output.connect(protection);
	protection.connect(master);
	master.connect(destination);
	/** Update listening balance without changing the recording bus gain. */
	const setLevels = (next: MixerLevels): void => {
		/** Replace prior automation, preserving current amplitude except for exact mute. */
		const set = (node: GainNode, value: number): void => {
			const gain = clampGain(value);
			const previous = node.gain.value;
			node.gain.cancelScheduledValues(0);
			node.gain.value = previous;
			if (gain === 0) node.gain.value = 0;
			else node.gain.setTargetAtTime(gain, context.currentTime, .005);
		};
		set(master, next.master);
		set(melody, next.melody);
		set(click, next.click);
	};
	// Initial gains are immediate: no burst at unity while an envelope settles.
	master.gain.value = clampGain(levels.master);
	melody.gain.value = clampGain(levels.melody);
	click.gain.value = clampGain(levels.click);
	return {
		program, melody, click, output, master, setLevels,
		/** Disconnect every node owned by this mixer. */
		dispose() {
			for (const node of [program, melody, click, output, protection, master]) node.disconnect();
		}
	};
}

const levels: MixerLevels = { ...MIXER_DEFAULTS };
const listeners = new Set<(levels: MixerLevels) => void>();
/** Read configured levels even before the audio context has been started. */
export function getMixerLevels(): MixerLevels { return { ...levels }; }
/** Configure once from settings and update all active audio branches together. */
export function setMixerLevels(update: Partial<MixerLevels>): void {
	for (const key of Object.keys(MIXER_DEFAULTS) as (keyof MixerLevels)[]) {
		if (update[key] !== undefined) levels[key] = clampGain(update[key], 1, MIXER_DEFAULTS[key]);
	}
	for (const listener of listeners) listener(getMixerLevels());
}
/** Subscribe without constructing an AudioContext or eagerly loading instruments. */
export function subscribeMixer(listener: (levels: MixerLevels) => void): () => void {
	listeners.add(listener);
	listener(getMixerLevels());
	return () => { listeners.delete(listener); };
}
