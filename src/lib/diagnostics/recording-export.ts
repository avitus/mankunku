/**
 * The diagnostic export of a saved recording — ONE builder for every surface
 * that hands a take to a scoring investigation: /diagnostics' "Download
 * diagnostics" + "Download WAV" buttons and the admin "Flag Scoring Error"
 * button on /progress. The pair it produces, `<date>-<slug>.json` and
 * `<date>-<slug>.wav`, drops straight into `tests/fixtures/recordings/` and is
 * what `tests/integration/pitch-replay.test.ts` replays; keeping the two
 * surfaces on this module is what keeps their files interchangeable.
 *
 * Everything here is browser-side except the three pure functions
 * (`encodeWavMono16`, `fixtureBaseName`, `buildDiagnosticsPayload`), which
 * are unit-tested in Node.
 */

import { replayFromBlob } from '$lib/audio/replay';
import {
	segmentNotes,
	resolveOnsets,
	findReArticulations,
	getMetronomeBleedOnsets
} from '$lib/audio/note-segmenter';
import { diagnosticsReplayFrame } from '$lib/audio/capture-window';
import {
	describeCaptureAlignment,
	type CaptureAlignment,
	type CaptureTiming
} from '$lib/audio/capture-timing';
import type { PitchReading } from '$lib/audio/pitch-frame';
import type { DetectedNote } from '$lib/types/audio';
import type { Phrase } from '$lib/types/music';
import type { Score, BleedFilterLog } from '$lib/types/scoring';
import type { BackingTrackLog } from '$lib/audio/backing-track';
import type { RecordingRecord, RecordingSummary } from '$lib/persistence/audio-store';

/** A saved recording replayed through the current detector in its own scoring frame. */
export interface RecordingReplay {
	readings: PitchReading[];
	/** Sub-threshold frames, same (trimmed) frame as `readings`. */
	weakReadings: PitchReading[];
	/** Raw worklet onsets, in the replay frame. */
	onsets: number[];
	/** Base + re-articulation onsets the segmenter was handed. */
	resolvedOnsets: number[];
	segmented: DetectedNote[];
	/** The duration the take's own scoring path segmented over. */
	duration: number;
	sampleRate: number;
	/**
	 * Lead-in `trimToPerformance` removed from the decoded blob — ear training
	 * only; 0 for every other source (`diagnosticsReplayFrame`). Everything
	 * else on this object is in the replay frame; the blob and the WAV are not,
	 * so anything correlating the two needs this.
	 */
	trimOffset: number;
	/**
	 * Where the blob's first sample sits on the audio clock, measured from the
	 * take's saved capture timing against the UNTRIMMED replay. Null on takes
	 * recorded before 2026-09-17, which carry no capture timing.
	 */
	alignment: CaptureAlignment | null;
}

/** What an admin reported when flagging a take as mis-scored. */
export interface ScoringFlag {
	/** What they heard go wrong, in their words. */
	note: string;
	/** ISO instant of the flag. */
	flaggedAt: string;
}

export interface DiagnosticsExportOptions {
	instrument: { id: string; name: string; key: string };
	/**
	 * The phrase the session actually played — notes, key, harmony — so a take
	 * on a user-written lick (which lives in no data file) can be rescored
	 * offline. /diagnostics has no phrase to hand and leaves it null.
	 */
	phrase?: Phrase | null;
	/** Present only on an export made by the "Flag Scoring Error" button. */
	flag?: ScoringFlag | null;
}

/**
 * Self-contained JSON snapshot for bug reports. Captures everything an
 * algorithm-side investigation needs without re-running pitch detection:
 * raw worklet onsets, resolved onsets, every pitch reading, the current
 * segmenter output, and the saved-at-record-time detection / score.
 */
export interface DiagnosticsExport {
	version: 1;
	exportedAt: string;
	recording: { sessionId: string; timestamp: number; date: string };
	context: {
		phraseId: string | null;
		phraseName: string | null;
		source: 'ear-training' | 'lick-practice' | null;
		instrument: { id: string; name: string; key: string };
		concertKey: string | null;
		tempo: number | null;
		swing: number | null;
		backingTrackUsed: boolean;
		metronomeEnabled: boolean | null;
		transportSeconds: number | null;
		backingBleedOnsets: number[] | null;
	};
	audio: { duration: number; sampleRate: number; captureTrimSeconds: number };
	detection: {
		rawWorkletOnsets: number[];
		resolvedOnsets: number[];
		segmentedNotes: DetectedNote[];
		readings: PitchReading[];
		weakReadings: PitchReading[];
	};
	scoring: { savedDetectedNotes: DetectedNote[] | null; savedScore: Score | null };
	bleedFilterLog: BleedFilterLog | null;
	backingTrackLog: BackingTrackLog | null;
	captureTiming: CaptureTiming | null;
	captureAlignment: CaptureAlignment | null;
	phrase: Phrase | null;
	flag: ScoringFlag | null;
}

/**
 * Encode mono Float32 samples as a 16-bit PCM RIFF/WAVE byte buffer.
 * Matches the canonical format parsed by tests/helpers/audio-fixtures.ts
 * so the file can drop straight into tests/fixtures/recordings/.
 */
export function encodeWavMono16(samples: Float32Array, sampleRate: number): ArrayBuffer {
	const dataSize = samples.length * 2;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);

	/** Write a RIFF chunk identifier into the WAV header. */
	const writeAscii = (offset: number, s: string) => {
		for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
	};

	writeAscii(0, 'RIFF');
	view.setUint32(4, 36 + dataSize, true);
	writeAscii(8, 'WAVE');
	writeAscii(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true); // byte rate
	view.setUint16(32, 2, true); // block align
	view.setUint16(34, 16, true); // bits per sample
	writeAscii(36, 'data');
	view.setUint32(40, dataSize, true);

	let offset = 44;
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
		offset += 2;
	}
	return buffer;
}

/**
 * `<YYYY-MM-DD>-<slug>` — the corpus's name for a take (UTC date of the
 * recording, the phrase name slugged and capped), without an extension.
 */
export function fixtureBaseName(timestamp: number, phraseName: string | null | undefined): string {
	const date = new Date(timestamp).toISOString().slice(0, 10);
	const slug =
		(phraseName ?? 'recording')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)/g, '')
			.slice(0, 32) || 'recording';
	return `${date}-${slug}`;
}

/**
 * Replay a saved recording's blob through the current detector and
 * segmenter, framed and bleed-matched the way its own scoring path did, weak
 * readings included — so the result reproduces the saved score instead of
 * disagreeing with it. `ctx` is the shared AudioContext when the app has one;
 * otherwise the replay decodes through a context of its own.
 */
export async function replayRecording(
	full: RecordingRecord,
	ctx?: BaseAudioContext
): Promise<RecordingReplay> {
	const raw = await replayFromBlob(full.blob, ctx);
	// Measured on the untrimmed replay: the live readings are stamped from the
	// arm instant, the replay from the blob's first sample.
	const timing = full.metadata?.captureTiming;
	const alignment =
		timing && full.metadata
			? describeCaptureAlignment(timing, raw.readings, 4096 / raw.sampleRate, full.metadata.tempo)
			: null;
	// Replay in the frame the recording's own scoring path used: ear training
	// trims the armed lead-in and segments over the blob, lick practice
	// segments its window untrimmed, through its last reading.
	// `metadata.transportSeconds` always describes the blob's first sample,
	// hence the offset is added back on top of it.
	const trimmed = diagnosticsReplayFrame(full.metadata?.source, raw);
	const { readings, weakReadings, workletOnsets: onsets, duration } = trimmed;
	const baseOnsets = resolveOnsets(onsets, readings);
	// Reconstruct the bleed evidence the app scored against. Backing
	// recordings store their transient onsets directly (the metronome is
	// count-in only when backing plays, so the click grid would be false
	// evidence); older/metronome-only recordings reconstruct the click grid.
	// Without either, the segmenter runs unsuppressed and the replay can
	// disagree with the saved result — a phantom split on a click, most
	// often — which is exactly backwards for a debugging tool.
	const bleedOnsets =
		full.metadata?.backingBleedOnsets ??
		(full.metadata?.metronomeEnabled && full.metadata.transportSeconds != null
			? getMetronomeBleedOnsets(
					full.metadata.transportSeconds + trimmed.offset,
					full.metadata.tempo,
					duration
				)
			: undefined);
	const articulationOnsets = findReArticulations(readings, baseOnsets, bleedOnsets);
	const resolvedOnsets = [...baseOnsets, ...articulationOnsets].sort((a, b) => a - b);
	const segmented = segmentNotes(
		readings,
		resolvedOnsets,
		duration,
		undefined,
		undefined,
		undefined,
		onsets,
		bleedOnsets,
		articulationOnsets,
		weakReadings
	);
	return {
		readings,
		weakReadings,
		onsets,
		resolvedOnsets,
		segmented,
		duration,
		sampleRate: raw.sampleRate,
		trimOffset: trimmed.offset,
		alignment
	};
}

/** Build the JSON export of a replayed recording. */
export function buildDiagnosticsPayload(
	rec: RecordingSummary,
	replay: RecordingReplay,
	opts: DiagnosticsExportOptions
): DiagnosticsExport {
	const md = rec.metadata;
	return {
		version: 1,
		exportedAt: new Date().toISOString(),
		recording: {
			sessionId: rec.sessionId,
			timestamp: rec.timestamp,
			date: new Date(rec.timestamp).toISOString()
		},
		context: {
			phraseId: md?.phraseId ?? null,
			phraseName: md?.phraseName ?? null,
			source: md?.source ?? null,
			instrument: { ...opts.instrument },
			concertKey: md?.key ?? null,
			tempo: md?.tempo ?? null,
			swing: md?.swing ?? null,
			backingTrackUsed: md?.backingTrackLog != null,
			// Needed to reconstruct the metronome click grid offline — half of
			// these investigations turn on whether a candidate onset sits under
			// a click. Null on pre-2026-08-01 captures.
			metronomeEnabled: md?.metronomeEnabled ?? null,
			// Replay frame, matching `detection` below — the stored metadata
			// value describes the blob's first sample, so the lead-in this
			// replay discarded (if any) is added back on. Consumers hand this
			// straight to getMetronomeBleedOnsets.
			transportSeconds: md?.transportSeconds != null ? md.transportSeconds + replay.trimOffset : null,
			// Recording-relative backing onsets — the bleed evidence the live
			// path segmented with when backing was the time source.
			backingBleedOnsets: md?.backingBleedOnsets ?? null
		},
		audio: {
			// The duration the flow segmented over — for lick practice the
			// window through its last reading, not the WAV's length.
			duration: replay.duration,
			sampleRate: replay.sampleRate,
			// Seconds `trimToPerformance` dropped off the front. The sibling
			// .wav is the UNTRIMMED blob, so a test replaying an ear-training
			// take has to trim before its timeline matches `detection`. Always
			// 0 for sources whose scoring path does not trim (lick practice),
			// and for ear-training takes captured before it pre-armed its mic.
			captureTrimSeconds: replay.trimOffset
		},
		detection: {
			rawWorkletOnsets: replay.onsets,
			resolvedOnsets: replay.resolvedOnsets,
			segmentedNotes: replay.segmented,
			readings: replay.readings,
			// Sub-threshold frames — the ghost-note pass's evidence. Absent from
			// exports made before 2026-09-16.
			weakReadings: replay.weakReadings
		},
		scoring: {
			savedDetectedNotes: md?.detectedNotes ?? null,
			savedScore: md?.score ?? null
		},
		bleedFilterLog: md?.bleedFilterLog ?? null,
		backingTrackLog: md?.backingTrackLog ?? null,
		// Where the blob's first sample sits on the audio clock
		// (capture-timing.ts): the saved clocks and live readings, and what the
		// replay measured from them. Null on takes recorded before 2026-09-17.
		captureTiming: md?.captureTiming ?? null,
		captureAlignment: replay.alignment,
		phrase: opts.phrase ?? null,
		flag: opts.flag ?? null
	};
}

/**
 * Decode a recording blob (webm/opus as the recorder saves it, or any format
 * the browser decodes) and re-encode it as the corpus's 16-bit mono WAV — the
 * UNTRIMMED capture, start to finish.
 */
export async function decodeToWav(blob: Blob): Promise<ArrayBuffer> {
	const AC =
		globalThis.AudioContext ??
		(globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!AC) throw new Error('AudioContext not available');
	const ctx = new AC();
	try {
		const arrayBuffer = await blob.arrayBuffer();
		const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
		return encodeWavMono16(audioBuffer.getChannelData(0), audioBuffer.sampleRate);
	} finally {
		void ctx.close();
	}
}

/** Hand the browser a file to save. */
export function triggerDownload(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
