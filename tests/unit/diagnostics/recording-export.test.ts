import { describe, it, expect } from 'vitest';
import {
	buildDiagnosticsPayload,
	encodeWavMono16,
	fixtureBaseName,
	type RecordingReplay
} from '$lib/diagnostics/recording-export';
import type { RecordingMetadata, RecordingSummary } from '$lib/persistence/audio-store';
import type { Phrase } from '$lib/types/music';

/** 2026-10-17T00:45:32Z — the Third Walks Back to Root take. */
const TS = Date.UTC(2026, 9, 17, 0, 45, 32);

describe('encodeWavMono16', () => {
	/** Read a chunk identifier directly from the exported WAV bytes. */
	const ascii = (bytes: ArrayBuffer, at: number, n: number) =>
		String.fromCharCode(...new Uint8Array(bytes, at, n));

	it('writes the canonical 16-bit mono RIFF header the fixture loader parses', () => {
		const bytes = encodeWavMono16(new Float32Array([0, 0.5, -0.5]), 44100);
		const view = new DataView(bytes);
		expect(ascii(bytes, 0, 4)).toBe('RIFF');
		expect(view.getUint32(4, true)).toBe(36 + 6);
		expect(ascii(bytes, 8, 4)).toBe('WAVE');
		expect(ascii(bytes, 12, 4)).toBe('fmt ');
		expect(view.getUint32(16, true)).toBe(16);
		expect(view.getUint16(20, true)).toBe(1); // PCM
		expect(view.getUint16(22, true)).toBe(1); // mono
		expect(view.getUint32(24, true)).toBe(44100);
		expect(view.getUint32(28, true)).toBe(88200); // byte rate
		expect(view.getUint16(32, true)).toBe(2); // block align
		expect(view.getUint16(34, true)).toBe(16); // bits per sample
		expect(ascii(bytes, 36, 4)).toBe('data');
		expect(view.getUint32(40, true)).toBe(6);
		expect(bytes.byteLength).toBe(50);
	});

	it('scales samples to 16-bit and clamps anything past full scale', () => {
		const bytes = encodeWavMono16(new Float32Array([0, 0.5, -0.5, 1.5, -1.5]), 44100);
		const view = new DataView(bytes);
		/** Read a signed PCM sample after the fixed 44-byte WAV header. */
		const sample = (i: number) => view.getInt16(44 + i * 2, true);
		expect(sample(0)).toBe(0);
		expect(sample(1)).toBe(16383);
		expect(sample(2)).toBe(-16384);
		expect(sample(3)).toBe(32767);
		expect(sample(4)).toBe(-32768);
	});
});

describe('fixtureBaseName', () => {
	it('is the UTC date and the slugged phrase name, as the corpus names its takes', () => {
		expect(fixtureBaseName(TS, 'Third Walks Back to Root')).toBe('2026-10-17-third-walks-back-to-root');
	});

	it('slugs punctuation and case and trims the dashes it leaves', () => {
		expect(fixtureBaseName(TS, '  Sharp 9 / Flat 9 (Dom.) ')).toBe('2026-10-17-sharp-9-flat-9-dom');
	});

	it('caps the slug at 32 characters', () => {
		expect(fixtureBaseName(TS, 'a'.repeat(40))).toBe('2026-10-17-' + 'a'.repeat(32));
	});

	it('falls back to "recording" without a usable phrase name', () => {
		expect(fixtureBaseName(TS, null)).toBe('2026-10-17-recording');
		expect(fixtureBaseName(TS, '!!!')).toBe('2026-10-17-recording');
	});
});

describe('buildDiagnosticsPayload', () => {
	const INSTRUMENT = { id: 'tenor-sax', name: 'Tenor Saxophone', key: 'Bb' };

	/** Build ear-training metadata with a transport anchor for trim checks. */
	function metadata(): RecordingMetadata {
		return {
			phraseId: 'pfl-035_D',
			phraseName: 'Third Walks Back to Root',
			source: 'ear-training',
			tempo: 100,
			key: 'D',
			swing: 0.6,
			score: null,
			detectedNotes: [{ midi: 50, cents: 5, onsetTime: 0.266, duration: 1.267, clarity: 0.98 }],
			backingTrackLog: null,
			bleedFilterLog: null,
			transportSeconds: 396.7522448979592,
			metronomeEnabled: true
		};
	}

	/** Wrap optional metadata in the saved-recording summary passed to exports. */
	function summary(md: RecordingMetadata | null = metadata()): RecordingSummary {
		return { sessionId: 'sess-1', timestamp: TS, metadata: md };
	}

	/** Build a trimmed replay with overrides for export compatibility cases. */
	function replay(over: Partial<RecordingReplay> = {}): RecordingReplay {
		return {
			readings: [{ midiFloat: 50, midi: 50, cents: 0, clarity: 0.95, time: 0.3, frequency: 146.83, rms: 0.1 }],
			weakReadings: [],
			onsets: [0.2],
			resolvedOnsets: [0.2],
			segmented: [{ midi: 50, cents: 0, onsetTime: 0.2, duration: 1, clarity: 0.95 }],
			duration: 6.4,
			sampleRate: 44100,
			trimOffset: 1.4666666666666668,
			alignment: null,
			...over
		};
	}

	it('describes the take in the replay frame: the stored transport stamp plus the trim', () => {
		const r = replay();
		const payload = buildDiagnosticsPayload(summary(), r, { instrument: INSTRUMENT });
		expect(payload.version).toBe(1);
		expect(payload.recording).toEqual({ sessionId: 'sess-1', timestamp: TS, date: '2026-10-17T00:45:32.000Z' });
		expect(payload.context.phraseId).toBe('pfl-035_D');
		expect(payload.context.phraseName).toBe('Third Walks Back to Root');
		expect(payload.context.source).toBe('ear-training');
		expect(payload.context.instrument).toEqual(INSTRUMENT);
		expect(payload.context.concertKey).toBe('D');
		expect(payload.context.tempo).toBe(100);
		expect(payload.context.swing).toBe(0.6);
		expect(payload.context.backingTrackUsed).toBe(false);
		expect(payload.context.metronomeEnabled).toBe(true);
		expect(payload.context.transportSeconds).toBeCloseTo(396.7522448979592 + r.trimOffset, 12);
		expect(payload.context.backingBleedOnsets).toBeNull();
		expect(payload.audio).toEqual({ duration: 6.4, sampleRate: 44100, captureTrimSeconds: r.trimOffset });
		expect(payload.detection).toEqual({
			rawWorkletOnsets: r.onsets,
			resolvedOnsets: r.resolvedOnsets,
			segmentedNotes: r.segmented,
			readings: r.readings,
			weakReadings: r.weakReadings
		});
		expect(payload.scoring).toEqual({ savedDetectedNotes: metadata().detectedNotes, savedScore: null });
		expect(payload.captureTiming).toBeNull();
		expect(payload.captureAlignment).toBeNull();
	});

	it('tolerates a recording saved without metadata', () => {
		const payload = buildDiagnosticsPayload(summary(null), replay(), { instrument: INSTRUMENT });
		expect(payload.context.phraseId).toBeNull();
		expect(payload.context.transportSeconds).toBeNull();
		expect(payload.context.metronomeEnabled).toBeNull();
		expect(payload.scoring).toEqual({ savedDetectedNotes: null, savedScore: null });
		expect(payload.bleedFilterLog).toBeNull();
		expect(payload.backingTrackLog).toBeNull();
	});

	it('leaves the phrase and the flag null unless they are given', () => {
		const payload = buildDiagnosticsPayload(summary(), replay(), { instrument: INSTRUMENT });
		expect(payload.phrase).toBeNull();
		expect(payload.flag).toBeNull();
	});

	it('carries the phrase the session played and the scoring flag', () => {
		const phrase: Phrase = {
			id: 'pfl-035_D',
			name: 'Third Walks Back to Root',
			timeSignature: [4, 4],
			key: 'D',
			notes: [{ pitch: 50, duration: [1, 2], offset: [0, 1] }],
			harmony: [],
			difficulty: { level: 3, pitchComplexity: 6, rhythmComplexity: 1, lengthBars: 2 },
			category: 'pentatonic',
			tags: [],
			source: 'curated'
		};
		const flag = { note: 'the final D split into three notes', flaggedAt: '2026-10-17T02:00:00.000Z' };
		const payload = buildDiagnosticsPayload(summary(), replay(), { instrument: INSTRUMENT, phrase, flag });
		expect(payload.phrase).toEqual(phrase);
		expect(payload.flag).toEqual(flag);
	});
});
