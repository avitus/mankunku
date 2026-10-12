import { expect, it } from 'vitest';
import { resolveStaffEvents, type StaffEvent } from '$lib/tunes/import/staff-pitch';
const event = (
	position: number | null,
	accidental: StaffEvent['accidental'] = null,
	beat = 0
): StaffEvent => ({ beat, duration: 1, position, accidental, tied: false });
it('resolves the Black Orpheus whole note to F#4 under two sharps', () => {
	expect(resolveStaffEvents([event(1)], 'treble', 2)).toEqual([[0, 1, 'F#4']]);
});
it('carries printed naturals within one measure and resets on the next', () => {
	expect(resolveStaffEvents([event(1, 'natural'), event(1, null, 1)], 'treble', 2)).toEqual([
		[0, 1, 'F4'],
		[1, 1, 'F4']
	]);
	expect(resolveStaffEvents([event(1)], 'treble', 2)[0][2]).toBe('F#4');
});
it('preserves cross-bar ties but does not apply them to a different note', () => {
	expect(resolveStaffEvents([event(1)], 'treble', 2, 'F4')[0][2]).toBe('F4');
	expect(resolveStaffEvents([event(2)], 'treble', 2, 'F4')[0][2]).toBe('G4');
});
it('calibrates bass and C clefs and ledger lines without octave transposition', () => {
	expect(resolveStaffEvents([event(0)], 'bass', 0)[0][2]).toBe('G2');
	expect(resolveStaffEvents([event(4)], 'alto', 0)[0][2]).toBe('C4');
	expect(resolveStaffEvents([event(6)], 'tenor', 0)[0][2]).toBe('C4');
	expect(resolveStaffEvents([event(-2)], 'treble', 0)[0][2]).toBe('C4');
});
