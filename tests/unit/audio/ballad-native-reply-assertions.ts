import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import type { CompEvent, DrumEvent, NativeBalladReplyDecision } from '$lib/audio/backing-generation';
import baseline from '../../fixtures/audio/ballad-native-reply-before.json';

/** Reverse only the verified Saints F-sharp140 bar18 native reply, preserving the old full hash. */
export function assertHistoricalBalladReplyCompatibility(
	performance: { compEvents: readonly CompEvent[]; drumEvents: readonly DrumEvent[] },
	receipts: readonly NativeBalladReplyDecision[],
	expectedHash: string
): void {
	const before = baseline.historicalCompatibility;
	const attack = { absBeat: 74, time: '14217i', notes: [49, 58, 63, 68],
		duration: 0.7714285714285715, velocity: 42 };
	expect(performance.compEvents.filter(event => Math.floor(event.absBeat / 4) === 18)).toEqual([attack]);
	expect(performance.drumEvents).toContainEqual(before.source);
	expect(receipts).toEqual([{ version: 1, profile: 'ballad-late-pad-v1', barIndex: 18,
		source: { barIndex: 17, hit: before.source }, attack, drumCommentary: 'space' }]);
	const reconstructed = performance.compEvents.map(event => event.absBeat === 74 ? before.ordinary : event);
	expect(createHash('sha256').update(JSON.stringify(reconstructed)).digest('hex')).toBe(expectedHash);
}
