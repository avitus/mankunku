import type { SmplrPreset } from 'smplr';

const SPLENDID_BASE_URL = 'https://smpldsnds.github.io/sfzinstruments-splendid-grand-piano/samples';

/**
 * Restore the ten SFZ offsets omitted by smplr 1.0's hardcoded piano preset.
 * Source: sfzinstruments/SplendidGrandPiano@1c595d827b7fd7f0be3134aaed0f90b3662a09cf,
 * Data/{PP,MP,FF}.txt; identical mappings in the converted sample repository
 * smpldsnds/sfzinstruments-splendid-grand-piano@009793ebf849aee57f9a213aeaf8f2d1e2178f4f.
 * These are frames at the ORIGINAL FLAC rate of 44.1 kHz, not the OGG's 48 kHz
 * or the browser's decoded rate. The source SFZ also specifies a 0.5 ms attack.
 */
const SOURCE_OFFSETS: Readonly<Record<string, number>> = {
	'PP B0': 618, 'PP D1': 1046, 'PP G5': 135, 'PP B5': 324, 'PP C6': 57,
	'PP C#6': 265, 'PP A6': 146, 'Mp D3': 11, 'FF G1': 100, 'FF C3': 325
};

// AudioBuffers are context independent. Weak ownership permits reuse across
// live/offline loaders without retaining whole instrument banks indefinitely.
const preparedCopies = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>();
const preparedAssets = new WeakMap<AudioBuffer, string>();

/** Supplied buffers are raw source audio, or a previously prepared result. */
export function prepareBackingPianoSample(context: BaseAudioContext, preset: SmplrPreset,
	name: string, buffer: AudioBuffer): AudioBuffer {
	if (preset.samples.baseUrl.replace(/\/+$/, '') !== SPLENDID_BASE_URL) return buffer;
	let asset: string;
	try { asset = decodeURIComponent(preset.samples.map?.[name] ?? name); }
	catch { return buffer; }
	if (!Object.hasOwn(SOURCE_OFFSETS, asset)) return buffer;
	// A caller or a future smplr preset may already supply playback offsets.
	// Its explicit mapping owns the start point; do not compound it here.
	const hasOffset = (offset: number | undefined) => offset !== undefined && offset !== 0;
	if (hasOffset(preset.defaults?.offset) || preset.groups.some((group) =>
		group.regions.some((region) => region.sample === name && (hasOffset(group.offset) || hasOffset(region.offset))))) return buffer;
	if (preparedAssets.get(buffer) === asset) return buffer;
	const cached = preparedCopies.get(buffer)?.get(asset);
	if (cached) return cached;
	const start = Math.round(SOURCE_OFFSETS[asset] / 44100 * buffer.sampleRate);
	const ramp = Math.max(1, Math.round(0.0005 * buffer.sampleRate));
	if (!Number.isSafeInteger(start) || start <= 0 || !Number.isSafeInteger(buffer.length) || start + ramp >= buffer.length ||
		!Number.isInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1) return buffer;
	const prepared = context.createBuffer(buffer.numberOfChannels, buffer.length - start, buffer.sampleRate);
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const samples = buffer.getChannelData(channel).slice(start);
		// Avoid introducing a hard-cut click, retaining every later sample exactly.
		samples[0] = 0;
		for (let frame = 1; frame < ramp; frame++) samples[frame] *= frame / ramp;
		prepared.copyToChannel(samples, channel);
	}
	const copies = preparedCopies.get(buffer) ?? new Map<string, AudioBuffer>();
	copies.set(asset, prepared);
	preparedCopies.set(buffer, copies);
	preparedAssets.set(prepared, asset);
	return prepared;
}
