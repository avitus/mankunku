/**
 * Offline WAV bounce of the backing engine for the listening lab.
 *
 * Renders the exact events `scheduleBackingTrack` would schedule — same
 * generation call, same swing resolution, same mix math — through smplr's
 * `renderOffline` (no Tone.js: event ticks convert to absolute seconds by
 * plain math, which is all the Transport would do for a fixed tempo).
 *
 * The audio graph mirrors the live one: bass/comp gains inside the backing
 * gain, drums on their own gain with per-voice velocity trims applied at
 * trigger time. A bounce therefore sounds like the app, not an idealized
 * render.
 */

import type { Phrase } from '$lib/types/music';
import type { BackingInstrument, BackingStyle } from '$lib/types/instruments';
import { fractionToFloat } from '$lib/music/intervals';
import { BACKING_STYLES } from './backing-styles';
import {
	generateBacking,
	resolveBackingSwing,
	type GeneratedBacking
} from './backing-generation';
import { BACKING_BASE_TRIMS, voiceVelocity, type BackingMixLevels } from './backing-mix';
import { drumBufferForVelocity, type DrumBufferName } from './sample-maps';

/**
 * Tone.js Transport PPQ default — the live engine reads `transport.PPQ`, so
 * the bounce must use the same resolution for tick-identical placement.
 */
export const BOUNCE_PPQ = 192;

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
	phrase: Phrase;
	style: BackingStyle;
	tempo: number;
	/** The user/session melody swing (resolution to effective swing happens inside). */
	swing: number;
	instrument: BackingInstrument;
	volume: number;
	mix: BackingMixLevels;
}

export interface BounceResult {
	blob: Blob;
	filename: string;
	generated: GeneratedBacking;
	durationSeconds: number;
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
	return generateBacking(phrase.harmony, style, {
		phraseId: phrase.id,
		tempo,
		ppq: BOUNCE_PPQ,
		beatsPerBar: phrase.timeSignature[0],
		swing: resolveBackingSwing(params.swing, style, tempo),
		sectionMap: phrase.sectionMap
	});
}

export interface RenderOpts {
	tempo: number;
	instrument: BackingInstrument;
	volume: number;
	mix: BackingMixLevels;
	durationSeconds: number;
}

/**
 * Render `params` to a WAV blob. `drumBuffers` come from
 * `getDecodedDrumBuffersForBounce()` in backing-track.ts (same decode path
 * as the live kit, so codec quirks behave identically).
 */
export async function bounceBacking(
	params: BounceParams,
	drumBuffers: Partial<Record<DrumBufferName, AudioBuffer>>
): Promise<BounceResult> {
	const generated = generateForBounce(params);
	const durationSeconds =
		harmonyDurationBeats(params.phrase) * (60 / params.tempo) + BOUNCE_TAIL_SECONDS;
	const blob = await renderEventsToWav(generated, drumBuffers, {
		tempo: params.tempo,
		instrument: params.instrument,
		volume: params.volume,
		mix: params.mix,
		durationSeconds
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
	const { renderOffline, Smolken, SplendidGrandPiano, Soundfont, Sampler } = await import('smplr');
	const { tempo, volume, mix, durationSeconds } = opts;

	const result = await renderOffline(
		async (context) => {
			// Mirror the live graph (see backing-track.ts): backingGain carries
			// the overall level for bass+comp; drums ride their own gain into
			// the destination, scaled by volume × trim, with per-voice velocity
			// trims at trigger time.
			const backingGain = context.createGain();
			backingGain.gain.value = volume;
			backingGain.connect(context.destination);

			const bassGain = context.createGain();
			bassGain.gain.value = BACKING_BASE_TRIMS.bass * mix.bass;
			bassGain.connect(backingGain);

			const compGain = context.createGain();
			compGain.gain.value = BACKING_BASE_TRIMS.comp * mix.comp;
			compGain.connect(backingGain);

			const drumGain = context.createGain();
			drumGain.gain.value = volume * BACKING_BASE_TRIMS.drums * mix.drums;
			drumGain.connect(context.destination);

			const [bass, comp, drums] = await Promise.all([
				new Smolken(context, { instrument: 'Pizzicato', destination: bassGain }).load,
				opts.instrument === 'piano'
					? new SplendidGrandPiano(context, { destination: compGain }).load
					: new Soundfont(context, {
							instrument: 'drawbar_organ',
							kit: 'MusyngKite',
							destination: compGain
						}).load,
				// Explicit defaults for the same reason as the live kit: undefined
				// values clobber smplr's PARAM_DEFAULTS and NaN the voice.
				new Sampler(context, {
					buffers: drumBuffers as Record<string, AudioBuffer>,
					destination: drumGain,
					detune: 0,
					decayTime: 0.3,
					lpfCutoffHz: 20000
				}).load
			]);

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
				// Same velocity-layer selection as the live trigger path.
				const buffer = drumBufferForVelocity(e.drum, e.velocity);
				if (!(buffer in drumBuffers)) continue;
				drums.start({
					note: buffer,
					velocity: Math.round(
						voiceVelocity(e.velocity * BACKING_BASE_TRIMS[e.drum], mix[e.drum]) * 127
					),
					time: eventTicksToSeconds(e.time, BOUNCE_PPQ, tempo)
				});
			}
		},
		{ duration: durationSeconds, sampleRate: 44100 }
	);

	// Peak-normalize the bounce to −1 dBFS. The live mix is anchored ~20 dB
	// down by the CDN instrument trims (system volume compensates there),
	// but a WAV at that level reads as silence in a media player. Pure gain
	// on the rendered buffer: relative balance — the thing a listening pass
	// judges — is untouched, and both sides of an A/B normalize to the same
	// ceiling. Amplification is capped so a genuinely empty render stays
	// silent instead of becoming amplified noise floor.
	const { audioBufferToWav16 } = await import('smplr');
	const buffer = result.audioBuffer;
	let peak = 0;
	for (let c = 0; c < buffer.numberOfChannels; c++) {
		const data = buffer.getChannelData(c);
		for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
	}
	const gain = Math.min(50, peak > 0 ? 0.891 / peak : 1);
	if (gain !== 1) {
		for (let c = 0; c < buffer.numberOfChannels; c++) {
			const data = buffer.getChannelData(c);
			for (let i = 0; i < data.length; i++) data[i] *= gain;
		}
	}
	return audioBufferToWav16(buffer);
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
	const generated: GeneratedBacking = {
		bassEvents: json.bassEvents,
		compEvents: json.compEvents,
		drumEvents: json.drumEvents
	};
	const blob = await renderEventsToWav(generated, drumBuffers, {
		...opts,
		tempo,
		durationSeconds: eventsDurationSeconds(generated, tempo)
	});
	return { blob, tempo, label: `${json.phraseId ?? 'events'}@${tempo}` };
}
