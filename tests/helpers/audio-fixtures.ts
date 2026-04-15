/**
 * Test helpers for audio buffers and WAV fixtures.
 *
 * Used by unit tests of the replay harness (synthetic buffers) and by
 * the integration tests that replay real recordings from tests/fixtures/.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface FakeAudioBuffer {
	sampleRate: number;
	length: number;
	numberOfChannels: number;
	duration: number;
	getChannelData(channel: number): Float32Array;
}

/**
 * Build a minimal AudioBuffer shim around a Float32Array channel.
 * Enough surface to satisfy replay.ts — no need for the full Web Audio API.
 */
export function makeFakeAudioBuffer(
	channel: Float32Array,
	sampleRate: number
): FakeAudioBuffer {
	return {
		sampleRate,
		length: channel.length,
		numberOfChannels: 1,
		duration: channel.length / sampleRate,
		getChannelData(c: number) {
			if (c !== 0) throw new Error('fake buffer only supports channel 0');
			return channel;
		}
	};
}

/** Synthetic mono sine wave */
export function makeSine(
	frequency: number,
	durationSeconds: number,
	sampleRate: number = 48000,
	amplitude: number = 0.5
): Float32Array {
	const length = Math.floor(durationSeconds * sampleRate);
	const out = new Float32Array(length);
	const omega = 2 * Math.PI * frequency;
	for (let i = 0; i < length; i++) {
		out[i] = amplitude * Math.sin(omega * (i / sampleRate));
	}
	return out;
}

/**
 * Load a 16-bit PCM mono WAV file and return channel data + sample rate.
 * Minimal parser — supports the canonical RIFF/WAVE format emitted by
 * `ffmpeg -acodec pcm_s16le -ac 1 in.webm out.wav`.
 */
export function loadWavFixture(relPath: string): {
	channel: Float32Array;
	sampleRate: number;
} {
	const fullPath = resolve(__dirname, '..', 'fixtures', relPath);
	const bytes = readFileSync(fullPath);
	return parseWav(bytes);
}

function parseWav(bytes: Buffer): { channel: Float32Array; sampleRate: number } {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	if (
		readAscii(view, 0, 4) !== 'RIFF' ||
		readAscii(view, 8, 4) !== 'WAVE'
	) {
		throw new Error('not a RIFF/WAVE file');
	}

	let offset = 12;
	let sampleRate = 0;
	let numChannels = 0;
	let bitsPerSample = 0;
	let formatCode = 0;
	let dataStart = -1;
	let dataSize = 0;

	while (offset + 8 <= view.byteLength) {
		const chunkId = readAscii(view, offset, 4);
		const chunkSize = view.getUint32(offset + 4, true);
		const chunkStart = offset + 8;

		if (chunkId === 'fmt ') {
			formatCode = view.getUint16(chunkStart, true);
			numChannels = view.getUint16(chunkStart + 2, true);
			sampleRate = view.getUint32(chunkStart + 4, true);
			bitsPerSample = view.getUint16(chunkStart + 14, true);
		} else if (chunkId === 'data') {
			dataStart = chunkStart;
			dataSize = chunkSize;
			break;
		}

		offset = chunkStart + chunkSize + (chunkSize % 2);
	}

	if (dataStart < 0) throw new Error('no data chunk');
	if (formatCode !== 1) throw new Error(`unsupported format code ${formatCode} (want 1 = PCM)`);
	if (bitsPerSample !== 16) throw new Error(`unsupported bit depth ${bitsPerSample}`);
	if (numChannels < 1) throw new Error('no channels');

	const sampleCount = dataSize / 2 / numChannels;
	const channel = new Float32Array(sampleCount);
	for (let i = 0; i < sampleCount; i++) {
		// Read channel 0 (interleaved).
		const s = view.getInt16(dataStart + i * 2 * numChannels, true);
		channel[i] = s / 32768;
	}

	return { channel, sampleRate };
}

function readAscii(view: DataView, offset: number, length: number): string {
	let s = '';
	for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
	return s;
}
