import { createOutputProtection } from './output-protection';
import { createDrumMixer } from './drum-mixer';
import { BACKING_INPUT_REFERENCE, SAMPLE_OPTIONS, SOUNDFONT_OPTIONS } from './mixer-policy';
import { prepareReleasedArrangement } from './backing-arrangement';
import { connectBackingOutput } from './backing-output';
/**
 * Offline WAV bounce of the backing engine for the listening lab.
 *
 * Renders the exact events `scheduleBackingTrack` would schedule — same
 * generation call, same swing resolution, same mix math — through smplr's
 * `renderOffline` (no Tone.js: event ticks convert to absolute seconds by
 * plain math, which is all the Transport would do for a fixed tempo).
 *
 * The audio graph mirrors the live program: calibrated instrument/voice gains,
 * three drum pans and optional room sends feed a fixed-drive glue compressor.
 * One post-compression Backing fader precedes output protection. Master is a
 * listening control and is excluded from the file.
 */

import type { Phrase } from '$lib/types/music';
import type { BackingInstrument, BackingStyle } from '$lib/types/instruments';
import { fractionToFloat } from '$lib/music/intervals';
import { BACKING_STYLES } from './backing-styles';
import { assessTerminalArrangement, type TerminalArrangementInput } from './backing-terminal';
import { createBackingSampleLoader } from './backing-sample-loader';
import { backingKeyboardTrim } from './backing-keyboard-level';
import { loadBackingBass } from './backing-bass-instrument';
import {
	generateBacking,
	resolveBackingSwing,
	type GeneratedBacking
} from './backing-generation';
import {
	BACKING_BASE_TRIMS,
	BACKING_PANS,
	BACKING_BUS_COMPRESSOR,
	ROOM_SENDS,
	ROOM_RETURN_GAIN,
	voiceVelocity,
	type BackingMixLevels,
	type DrumFamily
} from './backing-mix';
import {
	drumBufferForVelocity,
	type DrumBufferName
} from './sample-maps';

/**
 * Tone.js Transport PPQ default — the live engine reads `transport.PPQ`, so
 * the bounce must use the same resolution for tick-identical placement.
 */
export const BOUNCE_PPQ = 192;

/** Offline render rate. The room IR must be decoded AT this rate
 *  (`getDecodedRoomIrForBounce(BOUNCE_SAMPLE_RATE)`): ConvolverNode.buffer
 *  throws NotSupportedError on a rate mismatch, unlike source-node
 *  buffers, which resample freely. */
export const BOUNCE_SAMPLE_RATE = 44100;

/** Bound browser offline audio allocation, including the requested release tail. */
export const MAX_BOUNCE_SECONDS = 600;

/** Seconds of tail after the last bar so releases and the room ring out. */
const BOUNCE_TAIL_SECONDS = 2.5;

/** Convert a generated event's tick time ("480i") to absolute seconds. */
export function eventTicksToSeconds(time: string, ppq: number, tempo: number): number {
	return (parseInt(time, 10) / ppq) * (60 / tempo);
}

/** Total harmony extent in quarter-note beats. */
export function harmonyDurationBeats(phrase: Phrase): number {
	let maxEnd = 0;
	for (const seg of phrase.harmony) {
		maxEnd = Math.max(maxEnd, (fractionToFloat(seg.startOffset) + fractionToFloat(seg.duration)) * 4);
	}
	return maxEnd;
}

export interface BounceParams {
	/** Listening-studio rolling policy only; captured separately from note generation RNG. */
	performanceEnergySeed?: number;
	phrase: Phrase;
	style: BackingStyle;
	tempo: number;
	/** The user/session melody swing (resolution to effective swing happens inside). */
	swing: number;
	instrument: BackingInstrument;
	volume: number;
	mix: BackingMixLevels;
	/** Same generation policy as live playback; original is an A/B reference. */
	orchestration?: 'original' | 'coordinated';
	/** Explicit finite ending; omitted/continue retains the current accompaniment. */
	ending?: 'continue' | 'hold-release';
	/** Scripted observation trace for the lab, shared with live preview generation. */
	soloFeatures?: readonly import('./ensemble-plan').SoloFeature[];
}

export interface BounceResult {
	blob: Blob;
	filename: string;
	generated: GeneratedBacking;
	durationSeconds: number;
}

/** Validate declared listening intent before an audio graph or ordinary score is prepared. */
export function resolveListeningTerminalArrangement(params: BounceParams): TerminalArrangementInput | undefined {
	if (params.ending !== 'hold-release' || params.orchestration !== 'coordinated' || !['swing', 'straight', 'ballad', 'bossa-nova'].includes(params.style)) return undefined;
	const phrase = params.phrase;
	const terminalArrangement: TerminalArrangementInput = { ending: 'hold-release', melody: phrase.notes };
	const assessment = assessTerminalArrangement(phrase.harmony, BACKING_STYLES[params.style], {
		phraseId: phrase.id, tempo: params.tempo, ppq: BOUNCE_PPQ, beatsPerBar: phrase.timeSignature[0], swing: params.swing,
		performanceForm: phrase.timeSignature[1] === 4 ? phrase.performanceForm : undefined,
		ensemble: {}, terminalArrangement
	});
	if (!assessment.available) throw new Error(`Hold & release is unavailable: ${assessment.reason}`);
	return terminalArrangement;
}

/** Deterministic-ish filename: preset, style, tempo, seed and date, no spaces. */
export function bounceFilename(phraseId: string, style: BackingStyle, tempo: number): string {
	const date = new Date().toISOString().slice(0, 10);
	const safeId = phraseId.replace(/[^a-zA-Z0-9-]/g, '_');
	return `${safeId}-${style}-${tempo}bpm-${date}.wav`;
}

/**
 * Generate the backing for `params` exactly as the live scheduler would.
 * Exported separately so the golden-JSON export shares one code path with
 * the audio bounce.
 */
export function generateForBounce(params: BounceParams): GeneratedBacking {
	const { phrase, tempo } = params;
	if (phrase.harmony.length === 0) {
		throw new Error(`Lab phrase ${phrase.id} has no harmony to bounce`);
	}
	const style = BACKING_STYLES[params.style];
	const terminalArrangement = resolveListeningTerminalArrangement(params);
	const generation = {
		phraseId: phrase.id,
		tempo,
		ppq: BOUNCE_PPQ,
		beatsPerBar: phrase.timeSignature[0],
		swing: resolveBackingSwing(params.swing, style, tempo),
		sectionMap: phrase.sectionMap,
		performanceForm: phrase.timeSignature[1] === 4 ? phrase.performanceForm : undefined,
		...(terminalArrangement ? { terminalArrangement } : {}),
		ensemble: params.orchestration === 'coordinated' && phrase.timeSignature[1] === 4
			? { soloFeatures: params.soloFeatures } : undefined
	};
	if (params.orchestration === 'coordinated' && !params.soloFeatures?.length && !terminalArrangement) {
		const released = prepareReleasedArrangement(phrase.harmony, style, generation, params.instrument, phrase.timeSignature[1], params.performanceEnergySeed ?? 0);
		if (released) return released;
		// The normal transport also falls back to Original for unsupported score shapes.
		return generateBacking(phrase.harmony, style, { ...generation, ensemble: undefined });
	}
	return generateBacking(phrase.harmony, style, generation);
}

export interface RenderOpts {
	style?: BackingStyle;
	tempo: number;
	instrument: BackingInstrument;
	volume: number;
	mix: BackingMixLevels;
	durationSeconds: number;
	/** Decoded room IR (from `getDecodedRoomIrForBounce`). Absent → dry,
	 *  exactly like the live graph when the IR fails to load. */
	roomIr?: AudioBuffer | null;
}

/**
 * Render `params` to a WAV blob. `drumBuffers` come from
 * `getDecodedDrumBuffersForBounce()` in backing-track.ts (same decode path
 * as the live kit, so codec quirks behave identically).
 */
export async function bounceBacking(
	params: BounceParams,
	drumBuffers: Partial<Record<DrumBufferName, AudioBuffer>>,
	roomIr?: AudioBuffer | null
): Promise<BounceResult> {
	const generated = generateForBounce(params);
	const durationSeconds =
		harmonyDurationBeats(params.phrase) * (60 / params.tempo) + BOUNCE_TAIL_SECONDS;
	const blob = await renderEventsToWav(generated, drumBuffers, {
		tempo: params.tempo,
		instrument: params.instrument,
		style: params.style,
		volume: params.volume,
		mix: params.mix,
		durationSeconds,
		roomIr
	});
	return {
		blob,
		filename: bounceFilename(params.phrase.id, params.style, params.tempo),
		generated,
		durationSeconds
	};
}

/**
 * Render pre-generated events to WAV. This is what lets a committed golden
 * events JSON — the permanent record of any past engine's output — become
 * the "old" side of a blind A/B without keeping old generator code alive.
 * Note: events render through the CURRENT mix trims and samples, so level
 * balance reflects today's chain; the comparison surface is placement,
 * swing and vocabulary, which live entirely in the events.
 */
export async function renderEventsToWav(
	generated: GeneratedBacking,
	drumBuffers: Partial<Record<DrumBufferName, AudioBuffer>>,
	opts: RenderOpts
): Promise<Blob> {
	if (!Number.isFinite(opts.durationSeconds) || opts.durationSeconds <= 0 || opts.durationSeconds > MAX_BOUNCE_SECONDS) {
		throw new RangeError('Browser WAV bounce is limited to 10 minutes. Export events JSON or use a shorter take.');
	}
	const { renderOffline, Smolken, SplendidGrandPiano, Soundfont, Sampler, Scheduler } =
		await import('smplr');
	const { tempo, volume, mix, durationSeconds } = opts;

	const result = await renderOffline(
		async (context) => {
			// Keep the live bus topology and fixed compressor drive.
			const busCompressor = context.createDynamicsCompressor();
			busCompressor.threshold.value = BACKING_BUS_COMPRESSOR.threshold;
			busCompressor.knee.value = BACKING_BUS_COMPRESSOR.knee;
			busCompressor.ratio.value = BACKING_BUS_COMPRESSOR.ratio;
			busCompressor.attack.value = BACKING_BUS_COMPRESSOR.attack;
			busCompressor.release.value = BACKING_BUS_COMPRESSOR.release;
			const protection = createOutputProtection(context);
			protection.connect(context.destination);
			connectBackingOutput(busCompressor, protection, volume);

			const backingGain = context.createGain();
			backingGain.gain.value = BACKING_INPUT_REFERENCE;
			backingGain.connect(busCompressor);

			const bassGain = context.createGain();
			bassGain.gain.value = BACKING_BASE_TRIMS.bass * mix.bass;
			bassGain.connect(backingGain);

			const compPan = context.createStereoPanner();
			compPan.pan.value = BACKING_PANS.comp;
			compPan.connect(backingGain);
			const compGain = context.createGain();
			compGain.gain.value = backingKeyboardTrim(opts.instrument, opts.style) * mix.comp;
			compGain.connect(compPan);

			const drumBus = context.createGain();
			drumBus.gain.value = BACKING_BASE_TRIMS.drums * mix.drums;
			drumBus.connect(backingGain);
			const drumPans = {} as Record<DrumFamily, StereoPannerNode>;
			for (const family of ['kick', 'snare', 'cymbals'] as const) {
				const pan = context.createStereoPanner();
				pan.pan.value = BACKING_PANS[family];
				pan.connect(drumBus);
				drumPans[family] = pan;
			}

			// Rate guard: a mismatched IR would make `convolver.buffer =` THROW
			// (killing the whole render, not just the room) — render dry
			// instead, exactly like the live graph does without an IR.
			if (opts.roomIr && opts.roomIr.sampleRate === context.sampleRate) {
				const convolver = context.createConvolver();
				convolver.buffer = opts.roomIr;
				const roomReturn = context.createGain();
				roomReturn.gain.value = ROOM_RETURN_GAIN * mix.room;
				convolver.connect(roomReturn);
				roomReturn.connect(backingGain);
				const kitSend = BACKING_BASE_TRIMS.drums * mix.drums;
				const tap = (source: AudioNode, key: keyof typeof ROOM_SENDS, scale: number): void => {
					const send = context.createGain();
					send.gain.value = ROOM_SENDS[key] * scale;
					source.connect(send);
					send.connect(convolver);
				};
				tap(bassGain, 'bass', 1);
				tap(compPan, 'comp', 1);
				tap(drumPans.kick, 'kick', kitSend);
				tap(drumPans.snare, 'snare', kitSend);
				tap(drumPans.cymbals, 'cymbals', kitSend);
			}

			// smplr dispatches a note synchronously only when its time is within
			// the scheduler's lookahead of currentTime; later notes sit in a
			// queue pumped by setInterval — wall clock, which never fires while
			// an offline render completes in milliseconds ("one beat of music").
			// A shared scheduler whose lookahead exceeds the whole render makes
			// every start dispatch synchronously onto the graph. (The earlier
			// OfflineAudioContext.suspend-checkpoint approach worked on Chromium
			// but Safari doesn't implement suspend on offline contexts.)
			const scheduler = new Scheduler(context, {
				lookaheadMs: (durationSeconds + 10) * 1000
			});
			const loader = createBackingSampleLoader(context);
			const [bass, comp, drums] = await Promise.all([
				loadBackingBass(context, Smolken, { instrument: 'Pizzicato', destination: bassGain, scheduler, loader }),
				opts.instrument === 'piano'
					? new SplendidGrandPiano(context, { ...SAMPLE_OPTIONS, destination: compGain, scheduler, loader }).load
					: new Soundfont(context, { ...SOUNDFONT_OPTIONS, instrument: 'drawbar_organ', kit: 'MusyngKite', destination: compGain, scheduler }).load,
				createDrumMixer(context, Sampler, drumBuffers, drumPans, () => scheduler)
			]);
			drums.setMix(mix);
			const drumSamplers = drums.samplers;

			for (const e of generated.bassEvents) {
				bass.start({
					note: e.midi,
					velocity: e.velocity,
					duration: e.duration,
					time: eventTicksToSeconds(e.time, BOUNCE_PPQ, tempo)
				});
			}
			for (const e of generated.compEvents) {
				const time = eventTicksToSeconds(e.time, BOUNCE_PPQ, tempo);
				for (const midi of e.notes) {
					comp.start({ note: midi, velocity: e.velocity, duration: e.duration, time });
				}
			}
			for (const e of generated.drumEvents) {
				// Same velocity-layer selection and family routing as the live
				// trigger path.
				const buffer = drumBufferForVelocity(e.drum, e.velocity);
				if (!(buffer in drumBuffers)) continue;
				drumSamplers[e.drum].start({
					note: buffer,
					velocity: Math.round(
						voiceVelocity(e.velocity, 1) * 127
					),
					time: eventTicksToSeconds(e.time, BOUNCE_PPQ, tempo)
				});
			}
		},
		{ duration: durationSeconds, sampleRate: BOUNCE_SAMPLE_RATE }
	);

	// Export the program at its calibrated level. Per-file normalization would
	// erase fader differences and make quiet/isolated A/B stems misleading.
	const { audioBufferToWav16 } = await import('smplr');
	return audioBufferToWav16(result.audioBuffer);
}

/** Shape of an exported/committed golden events JSON. */
export interface GoldenEventsJson extends GeneratedBacking {
	phraseId?: string;
	style?: string;
	tempo?: number;
	params?: { tempo?: number };
}

/** Duration covering every event plus ring-out. */
export function eventsDurationSeconds(generated: GeneratedBacking, tempo: number): number {
	let maxEnd = 0;
	for (const e of [...generated.bassEvents, ...generated.compEvents]) {
		maxEnd = Math.max(maxEnd, eventTicksToSeconds(e.time, BOUNCE_PPQ, tempo) + e.duration);
	}
	for (const e of generated.drumEvents) {
		maxEnd = Math.max(maxEnd, eventTicksToSeconds(e.time, BOUNCE_PPQ, tempo) + 2);
	}
	return maxEnd + BOUNCE_TAIL_SECONDS;
}

/**
 * Parse an exported golden events JSON (from the lab's "Export events
 * JSON" or a committed tests/fixtures/backing file) and render it to WAV.
 * Throws with a readable message on shape mismatch.
 */
export async function renderGoldenJsonToWav(
	raw: unknown,
	drumBuffers: Partial<Record<DrumBufferName, AudioBuffer>>,
	opts: Omit<RenderOpts, 'durationSeconds' | 'tempo'>
): Promise<{ blob: Blob; tempo: number; label: string }> {
	const json = raw as GoldenEventsJson;
	if (!Array.isArray(json?.bassEvents) || !Array.isArray(json?.compEvents) || !Array.isArray(json?.drumEvents)) {
		throw new Error('Not an events JSON: expected bassEvents/compEvents/drumEvents arrays');
	}
	const tempo = json.tempo ?? json.params?.tempo;
	// Guard degenerate tempi too: a 0/negative/near-zero value would blow up
	// the duration math (Infinity-second renders) rather than fail readably.
	if (!tempo || !Number.isFinite(tempo) || tempo < 20) {
		throw new Error('Events JSON carries no usable tempo (expected `tempo` or `params.tempo` ≥ 20)');
	}
	const style = json.style ?? opts.style;
	if (style !== undefined && !Object.hasOwn(BACKING_STYLES, style)) throw new Error('Events JSON carries an unsupported backing style');
	const generated: GeneratedBacking = {
		bassEvents: json.bassEvents,
		compEvents: json.compEvents,
		drumEvents: json.drumEvents
	};
	const blob = await renderEventsToWav(generated, drumBuffers, {
		...opts,
		style: style as BackingStyle | undefined,
		tempo,
		durationSeconds: eventsDurationSeconds(generated, tempo)
	});
	return { blob, tempo, label: `${json.phraseId ?? 'events'}@${tempo}` };
}
