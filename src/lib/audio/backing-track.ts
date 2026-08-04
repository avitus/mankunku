/**
 * Jazz backing track engine.
 *
 * Generates and schedules walking bass, piano/organ comping, and a
 * drum pattern synchronized to phrase harmony via the Tone.js Transport.
 *
 * Instruments:
 * - Upright bass (Smolken "Pizzicato" double-bass sample library)
 * - Piano (Salamander Grand Piano via smplr.SplendidGrandPiano) or
 *   organ (drawbar_organ GM SoundFont, MusyngKite kit)
 * - Drums: sampled kick, ride, hi-hat (Virtuosity Drums, CC0)
 */

import type { Phrase, HarmonicSegment, Note } from '$lib/types/music';
import type { PlaybackOptions } from '$lib/types/audio';
import type { BackingInstrument, BackingStyle } from '$lib/types/instruments';
import { fractionToFloat } from '$lib/music/intervals';
import { initAudio, getMasterGain, getAudioContext } from './audio-context';
import { chordSymbol } from '$lib/music/chords';
import { buildSchedule, type BackingTrackSchedule } from './backing-track-schedule';
import { BACKING_STYLES } from './backing-styles';
import {
	generateBacking,
	resolveEffectiveSwing,
	type BassEvent,
	type CompEvent,
	type DrumEvent
} from './backing-generation';
import { DRUM_BUFFERS, type DrumBufferName } from './sample-maps';
import {
	loadBackingMix,
	saveBackingMix,
	normalizeBackingMix,
	voiceVelocity,
	BACKING_BASE_TRIMS,
	type BackingMixLevels
} from './backing-mix';
import { extendHarmonyTail } from '$lib/data/progressions';

// ── Diagnostics log ──────────────────────────────────────────

export interface BackingTrackBeat {
	beat: number;
	bassMidi: number;
	compMidi: number[] | null;
	compVelocity: number | null;
	drumParts: string[];
	melodyMidi: number | null;
}

export interface BackingTrackSegmentLog {
	chord: string;
	startBeat: number;
	durationBeats: number;
	beats: BackingTrackBeat[];
}

export interface BackingTrackLog {
	timestamp: number;
	phraseId: string;
	phraseName: string;
	key: string;
	tempo: number;
	timeSignature: [number, number];
	segments: BackingTrackSegmentLog[];
}

const MAX_LOG_ENTRIES = 30;
const LOG_STORAGE_KEY = 'backing-track-log';

function loadLog(): BackingTrackLog[] {
	if (typeof sessionStorage === 'undefined') return [];
	try {
		const raw = sessionStorage.getItem(LOG_STORAGE_KEY);
		return raw ? JSON.parse(raw) : [];
	} catch {
		return [];
	}
}

function saveLog(log: BackingTrackLog[]): void {
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(log));
	} catch { /* quota exceeded — ignore */ }
}

const backingTrackLog: BackingTrackLog[] = loadLog();

/** Get the backing track diagnostics log (newest first). */
export function getBackingTrackLog(count = 20): BackingTrackLog[] {
	// Re-read from storage to handle SSR/hydration boundary
	if (backingTrackLog.length === 0 && typeof sessionStorage !== 'undefined') {
		const fresh = loadLog();
		backingTrackLog.push(...fresh);
	}
	return backingTrackLog.slice(0, count);
}

type ToneModule = typeof import('tone');
type SmplrSoundfont = import('smplr').Soundfont;
type SmplrSplendidPiano = import('smplr').SplendidGrandPiano;
type SmplrSmolken = import('smplr').Smolken;
type SmplrSampler = import('smplr').Sampler;

/** Comping instrument: SplendidGrandPiano (piano) or Soundfont (organ). */
type CompInstrument = SmplrSplendidPiano | SmplrSoundfont;
/** Bass instrument: Smolken upright-bass sample library. */
type BassInstrument = SmplrSmolken;

// ── Module-level state ───────────────────────────────────────

let tone: ToneModule | null = null;

// Pitched instruments (loaded lazily via smplr).  Piano uses the
// Salamander-sampled SplendidGrandPiano; organ uses the GM SoundFont;
// bass uses the Smolken pizzicato double-bass library.
let compInstrument: CompInstrument | null = null;
let bassInstrument: BassInstrument | null = null;
let currentInstrumentType: BackingInstrument | null = null;

// Gain nodes for independent volume control. `backingGain` carries the
// overall backing volume into master; `bassGain` and `compGain` hang off
// it so each instrument's mix trim is independent of the master level.
// The drum kit has its own node into master, scaled by volume × trim.
let backingGain: GainNode | null = null;
let bassGain: GainNode | null = null;
let compGain: GainNode | null = null;
let currentBackingVolume = 0.5;

// Per-instrument mix levels, persisted per device (see backing-mix.ts).
let mixLevels: BackingMixLevels = loadBackingMix();

/** Push the current volume + base trims + mix levels onto every live gain node. */
function applyMixGains(): void {
	if (backingGain) backingGain.gain.value = currentBackingVolume;
	if (bassGain) bassGain.gain.value = BACKING_BASE_TRIMS.bass * mixLevels.bass;
	if (compGain) compGain.gain.value = BACKING_BASE_TRIMS.comp * mixLevels.comp;
	if (drumGainNode) {
		drumGainNode.gain.value = currentBackingVolume * BACKING_BASE_TRIMS.drums * mixLevels.drums;
	}
}

/** Current per-instrument mix levels (copy). */
export function getBackingMix(): BackingMixLevels {
	return { ...mixLevels };
}

/**
 * Update per-instrument mix levels, apply them to any live gain nodes
 * immediately, and persist them for future sessions on this device.
 * Kick/ride/hihat trims take effect from the next drum trigger.
 */
export function setBackingMix(partial: Partial<BackingMixLevels>): void {
	mixLevels = normalizeBackingMix({ ...mixLevels, ...partial });
	saveBackingMix(mixLevels);
	applyMixGains();
}

// Drums: multi-sample kit loaded via smplr.Sampler with string aliases
// (`kick`, `ride`, `hihat`) mapped to CC0 Virtuosity Drums recordings.
let drumSampler: SmplrSampler | null = null;
let drumGainNode: GainNode | null = null;
/** Shared in-flight load promise so concurrent callers don't race and
 *  leak a gain node / sampler graph (single-flight pattern). */
let drumLoadPromise: Promise<void> | null = null;

// Scheduled parts
let bassPart: import('tone').Part<BassEvent> | null = null;
let compPart: import('tone').Part<CompEvent> | null = null;
let drumPart: import('tone').Part<DrumEvent> | null = null;
let activeSchedule: BackingTrackSchedule | null = null;

/** Monotonically increasing ID for cancelling stale loads. */
let currentLoadId = 0;

// ── Lazy initialisation ──────────────────────────────────────

async function getTone(): Promise<ToneModule> {
	if (!tone) tone = await import('tone');
	return tone;
}

/** Per-sample ceiling on the drum fetch, so one stalled request can't hang the kit. */
const DRUM_FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch + decode each drum sample, returning only the ones this browser can
 * actually decode. A failed fetch or an unsupported codec drops that drum
 * rather than throwing: the rest of the kit still plays, and smplr is handed
 * AudioBuffers so it never falls back to fetching `/{name}.{format}`.
 *
 * Each sample is raced against its own timer. Without one a stalled fetch never
 * settles, and since the caller awaits `Promise.all` that would leave
 * `ensureDrums()` — and every `loadBackingInstruments()` behind it — pending
 * forever rather than starting the session without drums.
 */
async function decodeDrumBuffers(
	audioCtx: AudioContext
): Promise<Record<DrumBufferName, AudioBuffer>> {
	const names = Object.keys(DRUM_BUFFERS) as DrumBufferName[];
	const entries = await Promise.all(
		names.map(async (name) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const load = (async () => {
				try {
					const response = await fetch(DRUM_BUFFERS[name]);
					if (!response.ok) return null;
					// decodeAudioData detaches the ArrayBuffer, so each sample needs
					// its own — never share one across drums.
					return [name, await audioCtx.decodeAudioData(await response.arrayBuffer())] as const;
				} catch {
					// Undecodable codec or a network failure.
					return null;
				}
			})();
			// Stop *waiting* on a stalled sample rather than aborting it. An
			// AbortController would be tidier, but WebKit surfaces the cancelled
			// request as a console error, which is exactly the class of noise
			// this whole function exists to remove — it reintroduced an
			// intermittent failure in the e2e console fixture. Letting the
			// request run on unobserved costs nothing: the buffer is simply
			// dropped, and the kit plays without that drum.
			const timeout = new Promise<null>((resolve) => {
				timer = setTimeout(() => resolve(null), DRUM_FETCH_TIMEOUT_MS);
			});
			try {
				return await Promise.race([load, timeout]);
			} finally {
				clearTimeout(timer);
			}
		})
	);
	return Object.fromEntries(entries.filter((e) => e !== null)) as Record<
		DrumBufferName,
		AudioBuffer
	>;
}

/**
 * Decode the drum kit for an offline bounce (listening lab). Independent of
 * the live sampler: buffers are fetched fresh (HTTP-cached) and handed to an
 * OfflineAudioContext-bound Sampler by the caller. AudioBuffers are
 * context-independent, so decoding against the live context is fine.
 */
export async function getDecodedDrumBuffersForBounce(): Promise<
	Partial<Record<DrumBufferName, AudioBuffer>>
> {
	const audioCtx = await initAudio();
	return decodeDrumBuffers(audioCtx);
}

async function ensureDrums(): Promise<void> {
	if (drumSampler) return;
	if (drumLoadPromise) return drumLoadPromise;

	drumLoadPromise = (async () => {
		const audioCtx = await initAudio();
		const { Sampler } = await import('smplr');

		// Build the graph locally first — only promote to module-level
		// refs on successful load so a rejection or a concurrent winner
		// can't leave an orphaned gain node wired to master.
		const gainNode = audioCtx.createGain();
		gainNode.gain.value = 0.4;
		gainNode.connect(getMasterGain());

		// Decode the drum samples ourselves rather than handing smplr the URL
		// map. Given URLs, smplr fetches each one and — whenever a decode
		// yields no buffer — silently retries at `${baseUrl}/${name}.${format}`,
		// which for our empty baseUrl is a site-root `/kick.ogg` that 404s.
		// Playwright's WebKit hits exactly that path: it fetches our OGG Vorbis
		// fine (200) but `decodeAudioData` throws `EncodingError`, so every drum
		// fell through to a bogus root request and a console error that failed
		// the e2e console fixture. Pre-decoded AudioBuffers skip smplr's fetch
		// entirely, so a codec the browser can't read leaves the kit silent
		// instead of chasing a missing file.
		//
		// Scope of the codec gap is genuinely uncertain: shipping Safari gained
		// Ogg Vorbis in 18.4, yet the WebKit 26.0 build Playwright ships still
		// fails to decode these files — so this may be a Playwright media-stack
		// limitation rather than a Safari one. Worth measuring on real Safari
		// before deciding whether the 199 OGGs in static/samples need a second
		// encoding; the guard below is correct either way.
		const decoded = await decodeDrumBuffers(audioCtx);

		// Explicit defaults required — smplr's samplerToSmplrJson puts
		// options.detune/decayTime/lpfCutoffHz into json.defaults, and
		// undefined values clobber PARAM_DEFAULTS via object spread,
		// producing NaN detune at playback and throwing inside Voice.
		const sampler = new Sampler(audioCtx, {
			buffers: decoded,
			destination: gainNode,
			detune: 0,
			decayTime: 0.3,
			lpfCutoffHz: 20000
		});

		try {
			await sampler.load;
			drumGainNode = gainNode;
			drumSampler = sampler;
		} catch (error) {
			sampler.disconnect();
			gainNode.disconnect();
			throw error;
		} finally {
			drumLoadPromise = null;
		}
	})();

	return drumLoadPromise;
}

/**
 * Load backing track instruments (bass + chord instrument).
 * Idempotent for the same chord instrument type.
 *
 * Bass: Smolken "Pizzicato" double-bass (loaded once, reused across types).
 * Piano: SplendidGrandPiano (Salamander, 16 velocity layers).
 * Organ: SoundFont drawbar_organ (MusyngKite kit — no better smplr option).
 */
export async function loadBackingInstruments(
	instrumentType: BackingInstrument = 'piano'
): Promise<void> {
	const loadId = ++currentLoadId;
	const audioCtx = await initAudio();
	if (loadId !== currentLoadId) return;

	// Create shared gain nodes if needed
	if (!backingGain) {
		backingGain = audioCtx.createGain();
		backingGain.gain.value = currentBackingVolume;
		backingGain.connect(getMasterGain());
	}
	if (!bassGain) {
		bassGain = audioCtx.createGain();
		bassGain.connect(backingGain);
	}
	if (!compGain) {
		compGain = audioCtx.createGain();
		compGain.connect(backingGain);
	}
	applyMixGains();

	const { Soundfont, SplendidGrandPiano, Smolken } = await import('smplr');
	if (loadId !== currentLoadId) return;

	// Load bass if not already loaded — pizzicato upright bass samples
	if (!bassInstrument) {
		const bass = new Smolken(audioCtx, {
			instrument: 'Pizzicato',
			destination: bassGain
		});
		await bass.load;
		if (loadId !== currentLoadId) {
			bass.disconnect();
			return;
		}
		bassInstrument = bass;
	}

	// Reload comp instrument only when type changes
	if (!compInstrument || currentInstrumentType !== instrumentType) {
		const newComp: CompInstrument = instrumentType === 'piano'
			? new SplendidGrandPiano(audioCtx, { destination: compGain })
			: new Soundfont(audioCtx, {
				instrument: 'drawbar_organ',
				kit: 'MusyngKite',
				destination: compGain
			});
		await newComp.load;
		if (loadId !== currentLoadId) {
			newComp.disconnect();
			return;
		}
		const oldComp = compInstrument;
		compInstrument = newComp;
		currentInstrumentType = instrumentType;
		if (oldComp) {
			oldComp.stop();
			oldComp.disconnect();
		}
	}

	// Preload the drum kit alongside the pitched instruments so
	// `scheduleBackingTrack`'s `ensureDrums()` resolves as a microtask rather
	// than a sample fetch. That await now precedes the first audible commit,
	// so a cold load there would delay bass and comp — possibly past the
	// scheduled `tickOffset` on a running transport.
	//
	// Best-effort, exactly like the pitched preload at the call site: a kit
	// failure must not stop bass and comp loading. `ensureDrums` is
	// single-flight and idempotent, so re-entry on an instrument change is
	// free, and a failure here still surfaces from `scheduleBackingTrack`.
	await ensureDrums().catch((err) => {
		console.warn('Drum kit preload failed (non-blocking):', err);
	});
}

/** Check if backing instruments are loaded and ready. */
export function isBackingLoaded(): boolean {
	return bassInstrument !== null && compInstrument !== null;
}

// ── Harmony fallback ─────────────────────────────────────────

/**
 * When phrase.harmony is empty, infer a tonic chord spanning the full phrase.
 */
function inferTonicChord(phrase: Phrase): HarmonicSegment[] {
	let maxEndBeat = 0;
	for (const note of phrase.notes) {
		const start = fractionToFloat(note.offset) * 4;
		const dur = fractionToFloat(note.duration) * 4;
		maxEndBeat = Math.max(maxEndBeat, start + dur);
	}
	// Express exact beat count as a whole-note fraction [beats, 4]
	const beats = Math.max(1, Math.ceil(maxEndBeat));
	return [
		{
			chord: { root: phrase.key, quality: 'maj7' },
			scaleId: 'major.ionian',
			startOffset: [0, 1],
			duration: [beats, 4]
		}
	];
}

/** Get total harmony duration in quarter-note beats. */
function getHarmonyDurationBeats(harmony: HarmonicSegment[]): number {
	let maxEnd = 0;
	for (const seg of harmony) {
		const start = fractionToFloat(seg.startOffset) * 4;
		const dur = fractionToFloat(seg.duration) * 4;
		maxEnd = Math.max(maxEnd, start + dur);
	}
	return maxEnd;
}

/** Beat at which the last note of the melody ends. */
function getMelodyDurationBeats(notes: Note[]): number {
	let maxEnd = 0;
	for (const note of notes) {
		const start = fractionToFloat(note.offset) * 4;
		const dur = fractionToFloat(note.duration) * 4;
		maxEnd = Math.max(maxEnd, start + dur);
	}
	return maxEnd;
}

/**
 * Hold the final chord for as many extra bars as the melody needs.
 *
 * Bass, comp and drum lengths are all derived from the harmony, so a phrase
 * whose melody outruns its harmony had its last bar play dry — `ballad-005`
 * (melody 12 beats over 8 of harmony) and `ballad-006` (8.5 over 8) in the
 * curated catalog. Lick practice never hit this because it already extends the
 * tail before scheduling; the ear-training path did not.
 *
 * Extending the harmony rather than patching each length separately keeps one
 * source of truth: bass and comp events are GENERATED from harmony, so padding
 * a length without extending the chords would have produced longer silence
 * rather than a covered final bar.
 *
 * Returns the harmony untouched when it already covers the melody.
 */
function extendHarmonyToCoverMelody(
	harmony: HarmonicSegment[],
	notes: Note[],
	beatsPerBar: number
): HarmonicSegment[] {
	const harmonyDuration = getHarmonyDurationBeats(harmony);
	const melodyDuration = getMelodyDurationBeats(notes);
	if (melodyDuration <= harmonyDuration) return harmony;

	return extendHarmonyTail(
		harmony,
		Math.ceil((melodyDuration - harmonyDuration) / beatsPerBar)
	);
}

// ── Log capture ──────────────────────────────────────────────

function captureLog(
	phrase: Phrase,
	harmony: HarmonicSegment[],
	bassEvents: BassEvent[],
	compEvents: CompEvent[],
	drumEvents: DrumEvent[],
	tempo: number
): void {
	// Index bass events by their beat position (quarters only — swung
	// pickups and ghosts belong to the beat they decorate).
	const bassByBeat = new Map<number, BassEvent>();
	for (const e of bassEvents) {
		if (e.absBeat % 1 !== 0) continue;
		bassByBeat.set(e.absBeat, e);
	}

	// Index comp events by their beat position
	const compByBeat = new Map<number, CompEvent>();
	for (const e of compEvents) {
		compByBeat.set(Math.floor(e.absBeat), e);
	}

	// Index drum hits by the beat they fall in (swung eighths included).
	const DRUM_LABELS: Record<DrumEvent['drum'], string> = { kick: 'Kick', ride: 'Ride', hihat: 'HH' };
	const drumsByBeat = new Map<number, Set<string>>();
	for (const e of drumEvents) {
		const beat = Math.floor(e.absBeat);
		const set = drumsByBeat.get(beat) ?? new Set<string>();
		set.add(DRUM_LABELS[e.drum]);
		drumsByBeat.set(beat, set);
	}

	// Index melody notes by beat position
	const melodyByBeat = new Map<number, number>();
	for (const note of phrase.notes) {
		if (note.pitch === null) continue;
		const beat = Math.round(fractionToFloat(note.offset) * 4);
		melodyByBeat.set(beat, note.pitch);
	}

	const segments: BackingTrackSegmentLog[] = [];
	for (const seg of harmony) {
		const startBeat = Math.round(fractionToFloat(seg.startOffset) * 4);
		const durationBeats = Math.round(fractionToFloat(seg.duration) * 4);
		const beats: BackingTrackBeat[] = [];

		for (let b = 0; b < durationBeats; b++) {
			const globalBeat = startBeat + b;

			const bassEvent = bassByBeat.get(globalBeat);
			const compEvent = compByBeat.get(globalBeat);

			beats.push({
				beat: globalBeat + 1, // 1-based for display
				bassMidi: bassEvent?.midi ?? -1,
				compMidi: compEvent?.notes ?? null,
				compVelocity: compEvent?.velocity ?? null,
				drumParts: [...(drumsByBeat.get(globalBeat) ?? [])],
				melodyMidi: melodyByBeat.get(globalBeat) ?? null
			});
		}

		segments.push({
			chord: chordSymbol(seg.chord.root, seg.chord.quality),
			startBeat: startBeat + 1,
			durationBeats,
			beats
		});
	}

	backingTrackLog.unshift({
		timestamp: Date.now(),
		phraseId: phrase.id,
		phraseName: phrase.name ?? phrase.id,
		key: phrase.key,
		tempo,
		timeSignature: phrase.timeSignature,
		segments
	});

	// Trim and persist
	if (backingTrackLog.length > MAX_LOG_ENTRIES) {
		backingTrackLog.length = MAX_LOG_ENTRIES;
	}
	saveLog(backingTrackLog);
}

// ── Scheduling ───────────────────────────────────────────────

/** Dispose only the scheduled parts (not the instruments). */
export function disposeBackingParts(): void {
	if (bassPart) {
		bassPart.dispose();
		bassPart = null;
	}
	if (compPart) {
		compPart.dispose();
		compPart = null;
	}
	if (drumPart) {
		drumPart.dispose();
		drumPart = null;
	}
	bassInstrument?.stop();
	compInstrument?.stop();
	drumSampler?.stop();
	activeSchedule = null;
}

/** Return the backing track schedule built during the last scheduleBackingTrack() call. */
export function getActiveSchedule(): BackingTrackSchedule | null {
	return activeSchedule;
}

/**
 * Trigger one-off chord stabs on the comp instrument, outside any
 * Tone.Part — used for the inter-lick ii-V transition cue. Times are
 * absolute AudioContext seconds and must be NEAR-NOW (within smplr's
 * ~200ms lookahead): that creates the voices immediately, so a later
 * compInstrument.stop() (disposeBackingParts, session teardown) can
 * always cut them. Far-future times would sit in smplr's internal
 * scheduler queue, which .stop() does not clear — the stab would sound
 * after the session ends. Schedule distant stabs as transport events
 * that call this at fire time instead.
 */
export function playTransitionChords(
	stabs: Array<{ notes: number[]; time: number; duration: number }>,
	velocity = 65
): void {
	if (!compInstrument) return;
	for (const stab of stabs) {
		for (const note of stab.notes) {
			compInstrument.start({ note, velocity, duration: stab.duration, time: stab.time });
		}
	}
}

/**
 * Schedule the backing track on the Tone.js Transport.
 *
 * @param phrase - The phrase whose harmony drives the backing track
 * @param options - Playback options (tempo, backing track settings)
 * @param tickOffset - Transport tick offset (e.g. count-in bar)
 * @param loop - If true, backing track loops for recording phase
 * @param isStillCurrent - Optional predicate called after each internal
 *   await.  Returning false short-circuits setup so a superseded
 *   invocation can't install stale `activeSchedule` / Tone.Parts over
 *   a newer phrase's backing.
 */
export async function scheduleBackingTrack(
	phrase: Phrase,
	options: PlaybackOptions,
	tickOffset: number,
	loop: boolean = false,
	isStillCurrent: () => boolean = () => true
): Promise<void> {
	if (!isBackingLoaded()) return;

	const Tone = await getTone();
	if (!isStillCurrent()) return;
	const transport = Tone.getTransport();
	const ppq = transport.PPQ;
	const beatsPerBar = phrase.timeSignature[0];

	const baseHarmony = phrase.harmony.length > 0 ? phrase.harmony : inferTonicChord(phrase);
	// Every backing length is derived from the harmony, so it has to reach the
	// end of the melody or the phrase's last bar plays dry.
	const harmony = extendHarmonyToCoverMelody(baseHarmony, phrase.notes, beatsPerBar);
	const style = BACKING_STYLES[options.backingStyle ?? 'swing'];

	// Load the kit BEFORE touching any state. This is the last await in the
	// function, so every bailout happens while nothing has been disposed and
	// nothing has been started — the supersession check is atomic with respect
	// to audible output. It used to sit after the bass and comp Parts were
	// already started, so being superseded mid-load left them playing with no
	// drums. Everything from here down is synchronous.
	//
	// `loadBackingInstruments` preloads the kit, so this is a no-op microtask
	// on every normal path rather than a sample fetch that could push the start
	// past `tickOffset`.
	await ensureDrums();
	if (!isStillCurrent()) return;

	disposeBackingParts();

	// ── Generate bass + comp + drum events ──────────────────
	const swing = resolveEffectiveSwing(options.swing, style);
	const { bassEvents, compEvents, drumEvents } = generateBacking(harmony, style, {
		phraseId: phrase.id,
		tempo: options.tempo,
		ppq,
		beatsPerBar,
		swing,
		sectionMap: phrase.sectionMap
	});

	const harmonyDurationBeats = getHarmonyDurationBeats(harmony);
	const harmonyTicks = Math.ceil(harmonyDurationBeats / beatsPerBar) * beatsPerBar * ppq;

	// ── Capture diagnostics log ─────────────────────────────
	captureLog(phrase, harmony, bassEvents, compEvents, drumEvents, options.tempo);

	// ── Build queryable schedule for bleed filter ───────────
	activeSchedule = buildSchedule(bassEvents, compEvents, tickOffset, ppq, options.tempo);

	// Schedule bass — Part starts at tickOffset with relative event times.
	// This matches the melody Part pattern (start at offset, events
	// relative) and avoids the fragile start(0)-with-absolute-events
	// pattern on a running transport.
	bassPart = new Tone.Part((time: number, event: BassEvent) => {
		bassInstrument?.start({
			note: event.midi,
			velocity: event.velocity,
			duration: event.duration,
			time
		});
	}, bassEvents);
	bassPart.start(`${tickOffset}i`);
	bassPart.loop = loop;
	if (loop) {
		bassPart.loopStart = 0;
		bassPart.loopEnd = `${harmonyTicks}i`;
	}

	// Schedule comp — same pattern as bass: relative events, start at offset
	compPart = new Tone.Part((time: number, event: CompEvent) => {
		for (const midi of event.notes) {
			compInstrument?.start({
				note: midi,
				velocity: event.velocity,
				duration: event.duration,
				time
			});
		}
	}, compEvents);
	compPart.start(`${tickOffset}i`);
	compPart.loop = loop;
	if (loop) {
		compPart.loopStart = 0;
		compPart.loopEnd = `${harmonyTicks}i`;
	}

	// ── Drums ───────────────────────────────────────────────
	// The kit is already loaded and the supersession check already passed
	// above, before any state was touched — see the comment there.
	// Drums are a Part like bass and comp (not a per-beat Sequence): the
	// swung ride eighths and section-final setups are tick-placed events,
	// generated up front so the whole kit shares the swing grid.
	setBackingTrackVolume(options.backingTrackVolume ?? 0.5);

	drumPart = new Tone.Part((time: number, event: DrumEvent) => {
		// Style velocities are 0-1; smplr Sampler takes MIDI 0-127. The
		// per-voice base trim and mix trim apply here because the kit is one
		// sampler — velocity is the only per-voice level lever.
		drumSampler?.start({
			note: event.drum as DrumBufferName,
			velocity: Math.round(
				voiceVelocity(event.velocity * BACKING_BASE_TRIMS[event.drum], mixLevels[event.drum]) * 127
			),
			time
		});
	}, drumEvents);
	drumPart.start(`${tickOffset}i`);
	drumPart.loop = loop;
	if (loop) {
		drumPart.loopStart = 0;
		drumPart.loopEnd = `${harmonyTicks}i`;
	}
}

// ── Exported API ─────────────────────────────────────────────

/**
 * Load instruments, schedule patterns, and prepare for playback.
 * Call before Transport.start().
 */
export async function startBackingTrack(
	phrase: Phrase,
	options: PlaybackOptions,
	keepLooping: boolean
): Promise<void> {
	const Tone = await getTone();
	const transport = Tone.getTransport();
	const ppq = transport.PPQ;
	const beatsPerBar = phrase.timeSignature[0];
	const barTicks = beatsPerBar * ppq;

	await loadBackingInstruments(options.backingInstrument);
	await scheduleBackingTrack(phrase, options, barTicks, keepLooping);
}

/** Full cleanup: dispose parts and instruments. */
export function disposeBackingTrack(): void {
	disposeBackingParts();
	if (bassInstrument) {
		bassInstrument.disconnect();
		bassInstrument = null;
	}
	if (compInstrument) {
		compInstrument.disconnect();
		compInstrument = null;
		currentInstrumentType = null;
	}
	if (drumSampler) {
		drumSampler.disconnect();
		drumSampler = null;
	}
	if (drumGainNode) {
		drumGainNode.disconnect();
		drumGainNode = null;
	}
	if (bassGain) {
		bassGain.disconnect();
		bassGain = null;
	}
	if (compGain) {
		compGain.disconnect();
		compGain = null;
	}
	if (backingGain) {
		backingGain.disconnect();
		backingGain = null;
	}
}

/** Adjust backing track volume at runtime (per-instrument trims ride on top). */
export function setBackingTrackVolume(volume: number): void {
	currentBackingVolume = Math.max(0, Math.min(1, volume));
	applyMixGains();
}
