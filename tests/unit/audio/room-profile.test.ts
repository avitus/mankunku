import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readProfile, restoreProfile, roomSetup, saveProfile } from '$lib/audio/room-profile';

const rate = 48000;
const left = new Float32Array(rate * 0.12);
left[100] = 0.4;
const filter = { left, right: new Float32Array(left.length) };

describe('device-local room calibration', () => {
	beforeEach(() => {
		const values = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value)
		});
	});
	afterEach(() => vi.unstubAllGlobals());

	it('round trips both channels and matches the audio setup', () => {
		const track = { getSettings: () => ({deviceId: 'webcam'}) } as MediaStreamTrack;
		const setup = roomSetup(track, { sampleRate: rate, sinkId: 'speakers' });
		saveProfile(null, setup, filter);
		expect(restoreProfile(readProfile(), setup, rate)).toEqual(filter);
		for (const [sinkId, sampleRate] of [['headphones',rate], ['speakers',44100]] as const) {
			const changed = roomSetup(track, { sampleRate, sinkId });
			expect(restoreProfile(readProfile(), changed, sampleRate)).toBeUndefined();
		}
	});

	it('remembers a rejected setup and lets a new calibration replace it', () => {
		expect(saveProfile(null, 'setup', null)).toBe(true);
		expect(restoreProfile(readProfile(), 'setup', rate)).toBeNull();
		expect(saveProfile(null, 'setup', filter)).toBe(false);
		expect(saveProfile(readProfile(), 'setup', filter)).toBe(true);
		expect(restoreProfile(readProfile(), 'setup', rate)).toEqual(filter);
	});

	it('treats corrupt or unavailable storage as a fresh session', () => {
		expect(restoreProfile('{"setup":"setup","left":"broken","right":"broken"}', 'setup', rate)).toBeUndefined();
		vi.stubGlobal('localStorage', { getItem() { throw new Error(); }, setItem() { throw new Error(); } });
		expect(readProfile()).toBeNull();
		expect(() => saveProfile(null, 'setup', filter)).not.toThrow();
	});
});
