import { describe, expect, it } from 'vitest';
import { namedUnlockMarkers } from '$lib/ui/lick-progress-markers';

const keys = ['C', 'G', 'F', 'D', 'B♭', 'A', 'E♭', 'E', 'A♭', 'B', 'D♭', 'F♯'];
const marker = (x: number, from: number, to: number) => ({ x, y: 30, from, to });

describe('named unlock markers', () => {
	it('names the newly earned keys, not the already unlocked entry key', () => {
		const result = namedUnlockMarkers([marker(60, 1, 2), marker(150, 4, 5)], keys, 26, 394);
		expect(result.map((m) => m.label)).toEqual(['G', 'B♭']);
	});
	it('combines crowded unlocks and retains every name', () => {
		const result = namedUnlockMarkers([marker(60, 1, 2), marker(62, 2, 3), marker(66, 3, 4)], keys, 26, 394);
		expect(result).toHaveLength(1);
		expect(result[0].label).toBe('G+2');
		expect(result[0].names).toEqual(['G', 'F', 'D']);
	});
	it('keeps wide labels and merged clusters inside the plot without overlap', () => {
		const result = namedUnlockMarkers([marker(26, 0, 1), marker(42, 1, 2), marker(365, 2, 7), marker(394, 7, 12)], keys, 26, 394);
		for (let i = 0; i < result.length; i++) {
			expect(result[i].left).toBeGreaterThanOrEqual(26);
			expect(result[i].left + result[i].width).toBeLessThanOrEqual(394);
			if (i) expect(result[i].left).toBeGreaterThanOrEqual(result[i - 1].left + result[i - 1].width + 3);
		}
		expect(result.flatMap((m) => m.names)).toEqual(keys);
	});
	it('does not invent names for invalid or missing key ranges', () => {
		expect(namedUnlockMarkers([marker(30, 0, 1)], [], 26, 394)).toEqual([]);
		expect(namedUnlockMarkers([marker(30, -1, 2), marker(60, 1, 13), marker(90, 2, 2)], keys, 26, 394)).toEqual([]);
	});
});
