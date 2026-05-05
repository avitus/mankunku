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
 *     the only path that works at all).
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
			const realGetUserMedia = navigator.mediaDevices?.getUserMedia?.bind(
				navigator.mediaDevices
			);
			if (navigator.mediaDevices) {
				navigator.mediaDevices.getUserMedia = async () => {
					try {
						// Try the real API first. On Chromium with --use-fake-* flags,
						// this works. On Firefox/WebKit it may fail or hang — fall
						// through to the synthetic stream below.
						if (realGetUserMedia) {
							const real = await Promise.race([
								realGetUserMedia({ audio: true }),
								new Promise<never>((_, rej) =>
									setTimeout(() => rej(new Error('gum-timeout')), 200)
								)
							]);
							return real;
						}
					} catch {
						// fall through
					}
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
