import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Mocks the browser audio surfaces that the app's recorder + mic-capture
 * code touch, so E2E specs can exercise the full UI flow without a real
 * microphone.
 *
 * Two surfaces are stubbed:
 *
 *  1. `navigator.mediaDevices.getUserMedia` returns a synthetic MediaStream
 *     built from an OscillatorNode — enough to satisfy MediaStreamSource and
 *     keep AudioContext happy. No real mic permission prompt fires (and on
 *     Firefox + WebKit, where Playwright can't grant 'microphone', this is
 *     the only path that works at all). The REAL API is never called, on any
 *     engine — not even raced against a timeout. It used to be tried first on
 *     Chromium (`--use-fake-device-for-media-stream`), and on 2026-09-03 that
 *     call hung forever on the dev Mac while its CoreAudio default output (a
 *     Universal Audio interface) was wedged — and a pending fake-device
 *     capture request wedges Chromium's audio service with it: every
 *     AudioContext created afterwards never renders a frame (measured with a
 *     standalone probe — a context created before the call ran, one created
 *     200 ms after it sat at currentTime 0 forever), Tone's transport never
 *     moved, and ten seconds later Chromium's stall watchdog logged "The
 *     AudioContext encountered an error from the audio device or the WebAudio
 *     renderer" on both. A test suite must not depend on the host's audio
 *     hardware, and the synthetic stream is what two of the three engines
 *     ran on already.
 *
 *  2. `window.MediaRecorder` is replaced with a class that, on `.stop()`,
 *     dispatches a `dataavailable` event with a pre-loaded Blob built from
 *     a test fixture WAV. The downstream `replayFromBlob()` pipeline
 *     (src/lib/audio/replay.ts) handles WAV identically to WebM, so the
 *     full scoring pipeline runs deterministically against fixture audio.
 *
 * Call BEFORE page.goto() — these install via addInitScript so they apply
 * to every navigation in the context.
 */

export interface AudioMockOptions {
	/** Path relative to tests/fixtures/recordings/ */
	fixturePath?: string;
}

const FIXTURES_DIR = resolve(__dirname, '..', '..', 'fixtures', 'recordings');

async function loadFixtureBytes(fixturePath: string): Promise<Uint8Array> {
	const full = resolve(FIXTURES_DIR, fixturePath);
	const buf = await readFile(full);
	return new Uint8Array(buf);
}

/**
 * Install the audio mock on the given page.
 *
 * If a fixturePath is provided, the mock MediaRecorder will yield a Blob
 * built from that file's bytes. Without a fixture, an empty Blob is yielded.
 */
export async function installAudioMock(
	page: Page,
	options: AudioMockOptions = {}
): Promise<void> {
	let fixtureBytes: number[] = [];
	let fixtureMime = 'audio/webm';
	if (options.fixturePath) {
		const bytes = await loadFixtureBytes(options.fixturePath);
		// Convert to plain array for serialization across the addInitScript boundary.
		fixtureBytes = Array.from(bytes);
		fixtureMime = options.fixturePath.endsWith('.wav') ? 'audio/wav' : 'audio/webm';
	}

	await page.addInitScript(
		([fixtureArr, mime]) => {
			const fixtureUint8 = new Uint8Array(fixtureArr as number[]);

			// ── getUserMedia stub ───────────────────────────────────────
			// Build a real MediaStream backed by a silent oscillator. Real
			// MediaStream + MediaStreamTrack instances satisfy code that
			// inspects them (track.kind === 'audio', track.stop(), etc.).
			// The browser's own getUserMedia is deliberately NOT called, not
			// even raced against a timeout: a pending fake-device capture
			// request can wedge Chromium's audio service so that no
			// AudioContext created after it ever renders (see the module
			// comment) — and a rejected race leaves the request pending.
			if (navigator.mediaDevices) {
				navigator.mediaDevices.getUserMedia = async () => {
					// Build a synthetic stream from an oscillator. This is enough
					// for AudioContext.createMediaStreamSource() to bind to.
					const ctx = new (window.AudioContext ||
						(window as unknown as { webkitAudioContext: typeof AudioContext })
							.webkitAudioContext)();
					const osc = ctx.createOscillator();
					const dest = ctx.createMediaStreamDestination();
					osc.connect(dest);
					osc.start();
					return dest.stream;
				};
			}

			// ── MediaRecorder stub ──────────────────────────────────────
			// Replaces the constructor. Inherits from EventTarget so calls
			// to addEventListener / dispatchEvent continue to work as the
			// production code expects.
			class MockMediaRecorder extends EventTarget {
				static isTypeSupported() {
					return true;
				}
				readonly mimeType: string;
				state: 'inactive' | 'recording' | 'paused' = 'inactive';
				ondataavailable: ((ev: BlobEvent) => void) | null = null;
				onstop: ((ev: Event) => void) | null = null;
				onerror: ((ev: Event) => void) | null = null;
				onstart: ((ev: Event) => void) | null = null;
				constructor(_stream: MediaStream, options?: { mimeType?: string }) {
					super();
					this.mimeType = options?.mimeType || (mime as string);
				}
				start() {
					this.state = 'recording';
					queueMicrotask(() => {
						this.dispatchEvent(new Event('start'));
						this.onstart?.(new Event('start'));
					});
				}
				stop() {
					this.state = 'inactive';
					queueMicrotask(() => {
						const blob = new Blob([fixtureUint8], { type: this.mimeType });
						const ev = new Event('dataavailable') as BlobEvent;
						(ev as unknown as { data: Blob }).data = blob;
						this.dispatchEvent(ev);
						this.ondataavailable?.(ev);
						const stopEv = new Event('stop');
						this.dispatchEvent(stopEv);
						this.onstop?.(stopEv);
					});
				}
				pause() {
					this.state = 'paused';
				}
				resume() {
					this.state = 'recording';
				}
				requestData() {}
			}
			(window as unknown as { MediaRecorder: typeof MediaRecorder }).MediaRecorder =
				MockMediaRecorder as unknown as typeof MediaRecorder;
		},
		[fixtureBytes, fixtureMime] as [number[], string]
	);
}

// ── CDN instrument-sample stub ──────────────────────────────────────────────

/**
 * Build a tiny valid WAV (10ms of 44.1kHz mono PCM16 silence). Every browser
 * decodes PCM WAV — including Playwright's WebKit, whose media stack rejects
 * the OGG Vorbis the real CDNs serve. `decodeAudioData` sniffs content, not
 * URL extension, so serving these bytes for a `.ogg`/`.m4a` request is fine.
 */
function silentWavBuffer(): Buffer {
	const sampleRate = 44100;
	const numSamples = 441;
	const dataSize = numSamples * 2;
	const buf = Buffer.alloc(44 + dataSize); // zero-filled data = silence
	buf.write('RIFF', 0);
	buf.writeUInt32LE(36 + dataSize, 4);
	buf.write('WAVE', 8);
	buf.write('fmt ', 12);
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20); // PCM
	buf.writeUInt16LE(1, 22); // mono
	buf.writeUInt32LE(sampleRate, 24);
	buf.writeUInt32LE(sampleRate * 2, 28);
	buf.writeUInt16LE(2, 32);
	buf.writeUInt16LE(16, 34);
	buf.write('data', 36);
	buf.writeUInt32LE(dataSize, 40);
	return buf;
}

/**
 * Minimal SFZ manifest replacing the Smolken double-bass definition: one
 * region spanning the whole keyboard, pointing at a single sample that the
 * audio route below serves as silence. Keeps smplr's real sfz→preset→fetch
 * path exercised (regions exist, buffers decode) instead of special-casing
 * an empty instrument.
 */
const SFZ_STUB = '<region> sample=stub.wav lokey=0 hikey=127 pitch_keycenter=60\n';

/**
 * Fake midi-js soundfont file (the gleitz.github.io format smplr parses in
 * `midiJsToJson`): full chromatic range, every note the same silent WAV data
 * URI. The trailing comma after the last entry is REQUIRED — the parser
 * slices to `lastIndexOf(",")` and appends `}` itself.
 */
function soundfontJsStub(wavBase64: string): string {
	const PCS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
	const entries: string[] = [];
	for (let oct = 0; oct <= 7; oct++) {
		for (const pc of PCS) {
			entries.push(`"${pc}${oct}": "data:audio/wav;base64,${wavBase64}",`);
		}
	}
	return `MIDI.Soundfont.stub = {\n${entries.join('\n')}\n}`;
}

/**
 * Intercept the external sample CDNs and serve tiny silent WAVs instead.
 *
 * Three hosts, all load-bearing for wall-clock time in CI:
 *  - smpldsnds.github.io — SplendidGrandPiano fetches ~250 sample files (16
 *    velocity layers, no note filtering) and the Smolken bass fetches an
 *    .sfz manifest + samples. This is the cold-start cost that pushed WebKit
 *    past 45s of sample loading per test (PR #205).
 *  - gleitz.github.io — WebKit can't decode the local OGG tenor-sax samples,
 *    so playback.ts falls back to a multi-MB base64-mp3 MusyngKite soundfont
 *    from here on EVERY WebKit test that plays melody.
 *  - goldst.dev — soundfont loop metadata (loadLoopData: true).
 *
 * OPT-IN PER SPEC, and only for flow tests that never assert audible output.
 * Specs that verify produced audio (backing-render RMS coverage checks,
 * sample decode tests) must keep loading the real samples.
 *
 * Call BEFORE page.goto().
 */
export async function stubCdnInstrumentSamples(page: Page): Promise<void> {
	const wav = silentWavBuffer();
	const soundfontJs = soundfontJsStub(wav.toString('base64'));
	// Fulfilled cross-origin fetches still go through CORS checks.
	const CORS = { 'access-control-allow-origin': '*' };

	await page.route('https://smpldsnds.github.io/**', (route) => {
		const url = route.request().url();
		if (url.endsWith('.sfz')) {
			return route.fulfill({ headers: CORS, contentType: 'text/plain', body: SFZ_STUB });
		}
		return route.fulfill({ headers: CORS, contentType: 'audio/wav', body: wav });
	});

	await page.route('https://gleitz.github.io/**', (route) =>
		route.fulfill({
			headers: CORS,
			contentType: 'application/javascript',
			body: soundfontJs
		})
	);

	await page.route('https://goldst.dev/**', (route) =>
		route.fulfill({ headers: CORS, contentType: 'application/json', body: '{}' })
	);
}
