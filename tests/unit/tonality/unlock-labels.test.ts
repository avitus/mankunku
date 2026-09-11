import { describe, it, expect } from 'vitest';
import {
	formatNextKeyUnlock,
	formatKeyUnlockRequirements,
	nextKeyUnlock
} from '$lib/tonality/tonality';
import { INSTRUMENTS } from '$lib/types/instruments';
import type { UnlockContext } from '$lib/types/progress';

/**
 * Key-unlock labels on /progress ("Next: …") and the Settings key pad
 * (locked-key tooltip). Concert pitch is internal only: every key a player
 * reads — the key being unlocked AND the prerequisite key — is spelled at
 * written pitch for their instrument. A tenor reads a major ninth up
 * (concert G → A, C → D), an alto a major sixth up (G → E, C → A).
 */

const EMPTY: UnlockContext = { scaleProficiency: {}, keyProficiency: {} };
const TENOR = INSTRUMENTS['tenor-sax'];
const ALTO = INSTRUMENTS['alto-sax'];
const CONCERT = INSTRUMENTS['concert'];

describe('formatNextKeyUnlock', () => {
	// A new user's frontier: concert G, gated on concert C ≥ 10.
	const next = nextKeyUnlock(EMPTY)!;

	it('spells the next key and its prerequisite at written pitch on a tenor', () => {
		expect(formatNextKeyUnlock(next, TENOR)).toBe('A — D ≥ 10 (now 0)');
	});

	it('spells them at written pitch on an alto', () => {
		expect(formatNextKeyUnlock(next, ALTO)).toBe('E — A ≥ 10 (now 0)');
	});

	it('leaves them as stored for the concert-pitch instrument', () => {
		expect(formatNextKeyUnlock(next, CONCERT)).toBe('G — C ≥ 10 (now 0)');
	});

	it('transposes every requirement in a multi-requirement unlock, keeping levels verbatim', () => {
		const multi = {
			key: 'E' as const,
			requirements: [
				{ key: 'A' as const, level: 15, current: 12 },
				{ key: 'Bb' as const, level: 10, current: 10 }
			]
		};
		expect(formatNextKeyUnlock(multi, TENOR)).toBe('F# — B ≥ 15 (now 12) + C ≥ 10 (now 10)');
	});
});

describe('formatKeyUnlockRequirements', () => {
	it('names the prerequisite key at written pitch on a tenor', () => {
		// Concert G needs concert C; concert D needs concert G.
		expect(formatKeyUnlockRequirements('G', TENOR)).toBe('Requires D proficiency level 10');
		expect(formatKeyUnlockRequirements('D', TENOR)).toBe('Requires A proficiency level 10');
	});

	it('names it at written pitch on an alto', () => {
		expect(formatKeyUnlockRequirements('G', ALTO)).toBe('Requires A proficiency level 10');
		expect(formatKeyUnlockRequirements('D', ALTO)).toBe('Requires E proficiency level 10');
	});

	it('leaves it as stored for the concert-pitch instrument', () => {
		expect(formatKeyUnlockRequirements('G', CONCERT)).toBe('Requires C proficiency level 10');
		expect(formatKeyUnlockRequirements('F#', CONCERT)).toBe('Requires B proficiency level 15');
	});

	it('reads a key with no prerequisites as its own written name', () => {
		expect(formatKeyUnlockRequirements('C', TENOR)).toBe('D');
		expect(formatKeyUnlockRequirements('C', ALTO)).toBe('A');
		expect(formatKeyUnlockRequirements('C', CONCERT)).toBe('C');
	});
});
