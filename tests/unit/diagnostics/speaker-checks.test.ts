import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { clearSpeakerExamples, includeListenAudio, recordSpeakerCheck, speakerExampleCount, speakerReport, type SpeakerCheck } from '$lib/diagnostics/speaker-checks';

afterEach(() => vi.unstubAllGlobals());

it('exports every captured Listen check, including repeated results, and trims audio with its measurement', async () => {
	vi.stubGlobal('indexedDB', new IDBFactory());
	const storage = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => storage.get(k) ?? null,
		setItem: (k: string, v: string) => storage.set(k, v),
		removeItem: (k: string) => storage.delete(k)
	});
	includeListenAudio(true);
	const wave = new Float32Array([0.3]);
	const samples = { rate: 44100, left: wave, right: wave, mic: wave };
	const filter = { left: wave, right: wave };
	const event: SpeakerCheck = { at: new Date().toISOString(), stage: 'listen', result: 'active', rate: samples.rate };
	for (let i = 0; i < 12; i++) {
		const cue = {...event, phraseId: String(i)};
		await recordSpeakerCheck(cue, {event: cue, samples, filter});
	}
	includeListenAudio(false);
	await recordSpeakerCheck(event);
	const report = async () => JSON.parse(await (await speakerReport()).text());
	const first = await report();
	expect(first.examples.map((x: {event: SpeakerCheck}) => x.event.phraseId)).toEqual(Array.from({ length: 12 }, (_, i) => String(i)));
	expect(first.checks.map((x: {audioIncluded: boolean}) => x.audioIncluded)).toEqual([...Array(12).fill(true), false]);
	for (let i = 0; i < 54; i++) await recordSpeakerCheck(event);
	expect(await speakerExampleCount()).toBe(9);
	const trimmed = await report();
	expect(trimmed.checks).toHaveLength(64);
	expect(trimmed.examples[0].event.phraseId).toBe('3');
	await clearSpeakerExamples();
	const cleared = await report();
	expect(cleared.checks).toHaveLength(64);
	expect(cleared.checks.every((x: {audioIncluded: boolean}) => !x.audioIncluded)).toBe(true);
	expect(cleared.examples).toEqual([]);
});
