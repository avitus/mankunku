import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every shipped audio sample must be in a codec that EVERY browser we support
 * can decode through `decodeAudioData`.
 *
 * This exists because three drum samples shipped as Ogg **FLAC** while the
 * other 196 files were Ogg **Opus**. Safari/WebKit cannot decode FLAC-in-Ogg
 * via Web Audio, so the drum kit silently failed to load for every Safari user
 * — and the visible symptom was a misleading `/kick.ogg` 404, because smplr
 * falls back to `baseUrl("") + name + ".ogg"` when a buffer fails to decode.
 *
 * A unit test can't run a decoder, but it can check the codec identifier in the
 * container, which is the actual invariant that broke. The browser side is
 * proven separately in `tests/e2e/audio-sample-decode.spec.ts`.
 */

const SAMPLES_ROOT = join(process.cwd(), 'static', 'samples');

/** Codec identifiers that appear in the first Ogg page's header packet. */
const CODEC_SIGNATURES: ReadonlyArray<{ magic: Buffer; name: string }> = [
	{ magic: Buffer.from('OpusHead', 'ascii'), name: 'Opus' },
	{ magic: Buffer.from([0x7f, 0x46, 0x4c, 0x41, 0x43]), name: 'FLAC' }, // \x7fFLAC
	{ magic: Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]), name: 'Vorbis' }, // \x01vorbis
	{ magic: Buffer.from('Speex   ', 'ascii'), name: 'Speex' }
];

/**
 * Codecs `decodeAudioData` handles in Chromium, Firefox AND WebKit.
 * FLAC-in-Ogg is deliberately absent — that is the bug this file guards.
 */
const DECODABLE_EVERYWHERE = new Set(['Opus', 'Vorbis']);

function listOggFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...listOggFiles(full));
		else if (entry.endsWith('.ogg')) out.push(full);
	}
	return out;
}

function codecOf(file: string): string {
	const head = readFileSync(file).subarray(0, 128);
	if (head.subarray(0, 4).toString('ascii') !== 'OggS') return 'not-ogg';
	for (const { magic, name } of CODEC_SIGNATURES) {
		if (head.includes(magic)) return name;
	}
	return 'unknown';
}

describe('shipped audio samples', () => {
	const files = listOggFiles(SAMPLES_ROOT);

	it('finds the sample tree (guards against a silently-empty sweep)', () => {
		// Without this, a bad root path would make every assertion below vacuous.
		expect(files.length).toBeGreaterThan(150);
	});

	it('ships only codecs that every supported browser can decode', () => {
		const offenders = files
			.map((f) => ({ file: f.replace(`${process.cwd()}/`, ''), codec: codecOf(f) }))
			.filter(({ codec }) => !DECODABLE_EVERYWHERE.has(codec));

		expect(
			offenders,
			`Ogg files in a codec some browser cannot decode via decodeAudioData.\n` +
				`FLAC-in-Ogg fails in Safari/WebKit and takes the whole instrument down ` +
				`silently. Re-encode to Opus:\n` +
				`  ffmpeg -i in.ogg -c:a libopus -b:a 128k -vbr on -application audio out.ogg\n` +
				`(omit -ac/-ar so the source channel count and rate are preserved)`
		).toEqual([]);
	});

	it('keeps the drum kit specifically in Opus', () => {
		// Named separately so a regression on these three reports as itself
		// rather than as one entry in a list of 199.
		for (const name of ['kick', 'ride', 'hihat']) {
			expect(codecOf(join(SAMPLES_ROOT, 'drums', `${name}.ogg`)), name).toBe('Opus');
		}
	});
});
