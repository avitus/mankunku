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
import { pitchClassToNumber, shellVoicing, voiceLead } from './voicings';
import { chordSymbol } from '$lib/music/chords';
import { buildSchedule, type BackingTrackSchedule } from './backing-track-schedule';
import { BACKING_STYLES, type StyleDefinition } from './backing-styles';
import { DRUM_BUFFERS, type DrumBufferName } from './sample-maps';
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

// Gain nodes for independent volume control
let backingGain: GainNode | null = null;

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
let drumSequence: import('tone').Sequence<number> | null = null;
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

	// Create shared gain node if needed
	if (!backingGain) {
		backingGain = audioCtx.createGain();
		backingGain.gain.value = 0.5;
		backingGain.connect(getMasterGain());
	}

	const { Soundfont, SplendidGrandPiano, Smolken } = await import('smplr');
	if (loadId !== currentLoadId) return;

	// Load bass if not already loaded — pizzicato upright bass samples
	if (!bassInstrument) {
		const bass = new Smolken(audioCtx, {
			instrument: 'Pizzicato',
			destination: backingGain
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
			? new SplendidGrandPiano(audioCtx, { destination: backingGain })
			: new Soundfont(audioCtx, {
				instrument: 'drawbar_organ',
				kit: 'MusyngKite',
				destination: backingGain
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

// ── Bass generation ──────────────────────────────────────────

const BASS_REGISTER = 40; // E2 — center of upright bass range

/** Find nearest bass-register MIDI note for a pitch class. */
function nearestBassNote(pc: number, center: number): number {
	const centerPc = ((center % 12) + 12) % 12;
	let midi = center + ((pc - centerPc + 6 + 12) % 12 - 6);
	// Clamp to reasonable bass range (E1=28 to G3=55)
	if (midi < 28) midi += 12;
	if (midi > 55) midi -= 12;
	return midi;
}

/** Pick a chord tone for bass on a given beat index. */
function chordToneForBass(rootPc: number, quality: string, center: number, beatIndex: number): number {
	// Compute chord-tone intervals from quality
	const hasMinor3rd = quality.startsWith('min') || quality.includes('dim');
	const hasDim5th = quality.includes('dim') || quality.includes('b5');
	const hasAug5th = quality.includes('aug');

	const thirdInterval = hasMinor3rd ? 3 : 4;
	const fifthInterval = hasDim5th ? 6 : hasAug5th ? 8 : 7;

	// Chord tones ordered for melodic variety by beat position
	const tones = beatIndex % 2 === 1
		? [fifthInterval, thirdInterval, 0]
		: [thirdInterval, fifthInterval, 0];
	const offset = tones[beatIndex % tones.length];
	const pc = (rootPc + offset) % 12;
	return nearestBassNote(pc, center);
}

/** Chromatic approach note (half step below or above target). */
function approachNote(targetMidi: number): number {
	return Math.random() < 0.6 ? targetMidi - 1 : targetMidi + 1;
}

/** Subtle timing humanization for backing track (tighter than melody). */
function humanizeBeatTicks(ticks: number, ppq: number, tempo: number): number {
	const baseMs = 3;
	const tempoScale = 120 / tempo;
	const maxDeviationMs = baseMs * tempoScale;
	const msPerTick = (60 / tempo / ppq) * 1000;
	const maxDeviationTicks = Math.round(maxDeviationMs / msPerTick);
	const deviation = (Math.random() - 0.5) * 2 * maxDeviationTicks;
	return Math.max(0, Math.round(ticks + deviation));
}

interface BassEvent {
	time: string;
	midi: number;
	duration: number;
	velocity: number;
}

/**
 * Generate walking bass notes for the chord progression.
 * Uses chord tones on interior beats and chromatic approach notes
 * on the last beat of each segment to lead into the next root.
 */
function generateWalkingBass(
	harmony: HarmonicSegment[],
	beatsPerBar: number,
	tempo: number,
	ppq: number
): BassEvent[] {
	const events: BassEvent[] = [];
	const beatDuration = 60 / tempo;

	for (let segIdx = 0; segIdx < harmony.length; segIdx++) {
		const seg = harmony[segIdx];
		const rootPc = pitchClassToNumber(seg.chord.root);
		const rootMidi = nearestBassNote(rootPc, BASS_REGISTER);

		const segStartBeats = fractionToFloat(seg.startOffset) * 4;
		const segDurationBeats = fractionToFloat(seg.duration) * 4;
		const totalBeats = Math.round(segDurationBeats);

		// Next segment's root for approach notes (no wrapping on last segment)
		const hasNext = segIdx + 1 < harmony.length;
		const nextRootPc = hasNext ? pitchClassToNumber(harmony[segIdx + 1].chord.root) : rootPc;
		const nextRootMidi = hasNext ? nearestBassNote(nextRootPc, BASS_REGISTER) : rootMidi;

		for (let beat = 0; beat < totalBeats; beat++) {
			const beatOffset = segStartBeats + beat;
			const ticks = Math.round(beatOffset * ppq);
			let midi: number;

			if (beat === 0) {
				// Beat 1: always the root
				midi = rootMidi;
			} else if (beat === totalBeats - 1 && totalBeats > 1) {
				// Last beat: chromatic approach to next root
				midi = approachNote(nextRootMidi);
			} else if (beat === 1) {
				// Beat 2: chord tone (3rd or 5th)
				midi = chordToneForBass(rootPc, seg.chord.quality, BASS_REGISTER, 1);
			} else {
				// Beat 3+: alternate chord tones
				midi = chordToneForBass(rootPc, seg.chord.quality, BASS_REGISTER, beat);
			}

			// Subtle velocity humanization
			const velocity = 80 + Math.round((Math.random() - 0.5) * 10);

			events.push({
				time: `${humanizeBeatTicks(ticks, ppq, tempo)}i`,
				midi,
				duration: beatDuration * 0.85, // Slightly detached
				velocity
			});
		}
	}

	return events;
}

// ── Comping generation ───────────────────────────────────────

interface CompEvent {
	time: string;
	notes: number[];
	duration: number;
	velocity: number;
}

/**
 * Generate comp (chord) events with voice-led voicings.
 * Uses style definition to determine comping pattern.
 */
function generateComping(
	harmony: HarmonicSegment[],
	beatsPerBar: number,
	tempo: number,
	ppq: number,
	style: StyleDefinition
): CompEvent[] {
	const events: CompEvent[] = [];
	const beatDuration = 60 / tempo;

	// Voice-lead the chord sequence
	const chords = harmony.map(seg => ({ root: seg.chord.root, quality: seg.chord.quality }));
	const voicings = voiceLead(chords, shellVoicing, 54);

	for (let segIdx = 0; segIdx < harmony.length; segIdx++) {
		const seg = harmony[segIdx];
		const voicing = voicings[segIdx];
		if (!voicing || voicing.length === 0) continue;

		const segStartBeats = fractionToFloat(seg.startOffset) * 4;
		const segDurationBeats = fractionToFloat(seg.duration) * 4;
		const totalBeats = Math.round(segDurationBeats);

		for (let beat = 0; beat < totalBeats; beat++) {
			const beatInBar = Math.round(segStartBeats + beat) % beatsPerBar;
			const compResult = style.compPattern(beatInBar, beatsPerBar);

			if (!compResult.hit) continue;

			const beatOffset = segStartBeats + beat;
			const ticks = Math.round(beatOffset * ppq);

			const compDurationBeats = compResult.duration[0] / compResult.duration[1];
			events.push({
				time: `${humanizeBeatTicks(ticks, ppq, tempo)}i`,
				notes: voicing,
				duration: beatDuration * compDurationBeats,
				velocity: compResult.velocity
			});
		}
	}

	return events;
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
	beatsPerBar: number,
	ppq: number,
	tempo: number
): void {
	// Index bass events by their beat position
	const bassByBeat = new Map<number, BassEvent>();
	for (const e of bassEvents) {
		const ticks = parseInt(e.time);
		const beat = Math.round(ticks / ppq);
		bassByBeat.set(beat, e);
	}

	// Index comp events by their beat position
	const compByBeat = new Map<number, CompEvent>();
	for (const e of compEvents) {
		const ticks = parseInt(e.time);
		const beat = Math.round(ticks / ppq);
		compByBeat.set(beat, e);
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
			const beatInBar = globalBeat % beatsPerBar;

			const bassEvent = bassByBeat.get(globalBeat);
			const compEvent = compByBeat.get(globalBeat);

			const drumParts: string[] = [];
			if (beatInBar === 0) drumParts.push('Kick');
			drumParts.push('Ride');
			if (beatInBar === 1 || beatInBar === 3) drumParts.push('HH');

			beats.push({
				beat: globalBeat + 1, // 1-based for display
				bassMidi: bassEvent?.midi ?? -1,
				compMidi: compEvent?.notes ?? null,
				compVelocity: compEvent?.velocity ?? null,
				drumParts,
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
	if (drumSequence) {
		drumSequence.dispose();
		drumSequence = null;
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

	// ── Bass + Comp events ──────────────────────────────────
	const bassEvents = generateWalkingBass(harmony, beatsPerBar, options.tempo, ppq);
	const compEvents = generateComping(harmony, beatsPerBar, options.tempo, ppq, style);

	const harmonyDurationBeats = getHarmonyDurationBeats(harmony);
	const harmonyTicks = Math.ceil(harmonyDurationBeats / beatsPerBar) * beatsPerBar * ppq;

	// ── Capture diagnostics log ─────────────────────────────
	captureLog(phrase, harmony, bassEvents, compEvents, beatsPerBar, ppq, options.tempo);

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
	setBackingTrackVolume(options.backingTrackVolume ?? 0.5);

	const drumCallback = (time: number, beat: number) => {
		const hits = style.drumPattern(beat, beatsPerBar);
		const sampler = drumSampler;
		if (!sampler) return;
		// Style velocities are 0-1; smplr Sampler takes MIDI 0-127.
		const trigger = (note: DrumBufferName, velocity: number) => {
			sampler.start({ note, velocity: Math.round(velocity * 127), time });
		};
		if (hits.kick) trigger('kick', hits.kickVelocity ?? 0.5);
		if (hits.ride) trigger('ride', hits.rideVelocity ?? 0.4);
		if (hits.hihat) trigger('hihat', hits.hihatVelocity ?? 0.5);
	};

	const pattern = Array.from({ length: beatsPerBar }, (_, i) => i);

	if (!loop) {
		// Finite: phrase-length beats, aligned with pitched backing
		const phraseBars = Math.ceil(harmonyDurationBeats / beatsPerBar);
		const totalBeats = beatsPerBar * phraseBars;
		const allBeats = Array.from({ length: totalBeats }, (_, i) => i % beatsPerBar);

		drumSequence = new Tone.Sequence(drumCallback, allBeats, '4n');
		drumSequence.start(`${tickOffset}i`);
		drumSequence.loop = false;
	} else {
		drumSequence = new Tone.Sequence(drumCallback, pattern, '4n');
		drumSequence.start(`${tickOffset}i`);
		drumSequence.loop = true;
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
	if (backingGain) {
		backingGain.disconnect();
		backingGain = null;
	}
}

/** Adjust backing track volume at runtime. */
export function setBackingTrackVolume(volume: number): void {
	const v = Math.max(0, Math.min(1, volume));
	if (backingGain) backingGain.gain.value = v;
	if (drumGainNode) drumGainNode.gain.value = v * 0.6; // drums sit back in the mix
}
