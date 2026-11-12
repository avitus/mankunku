import { expect, it } from 'vitest';
import { describeCoordinatedPlacement } from '$lib/audio/coordinated-voicing';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { PITCH_CLASSES, type ChordQuality } from '$lib/types/music';

// Independent, deliberately allocation-heavy references pin all voice-entry/exit
// choices and doubled guide-tone assignments while the runtime kernels change.
function movement(from: readonly number[], to: readonly number[]): number {
 const matrix = Array.from({ length: from.length + 1 }, () => Array(to.length + 1).fill(0));
 for (let a = 0; a <= from.length; a++) for (let b = 0; b <= to.length; b++) {
  matrix[a][b] = a === 0 ? b * 12 : b === 0 ? a * 12 : Math.min(
   matrix[a - 1][b - 1] + Math.abs(from[a - 1] - to[b - 1]), matrix[a - 1][b] + 12, matrix[a][b - 1] + 12);
 }
 return matrix[from.length][to.length];
}
function pairs(notes: number[], root: number, quality: ChordQuality) {
 const intervals = CHORD_DEFINITIONS[quality].intervals;
 const third = intervals.includes(4) ? 4 : intervals.includes(3) ? 3 : intervals.includes(5) ? 5 : 2;
 const other = intervals.find(i => i >= 9 && i <= 11) ?? intervals.find(i => i >= 6 && i <= 8) ?? 7;
 return notes.filter(n => n % 12 === (root + third) % 12).flatMap(a => notes.filter(n => n % 12 === (root + other) % 12).map(b => [a,b]));
}
it('preserves voice-entry costs and all doubled-guide assignments across chords and registers', () => {
 const shapes = [[0,4], [4,10], [0,4,7,10], [4,7,10,14], [4,10,16,22], [0,4,7,10,12,16,19,22]];
 for (const quality of Object.keys(CHORD_DEFINITIONS) as ChordQuality[]) for (let root = 0; root < 12; root++) {
  for (let i = 0; i < shapes.length; i++) for (let j = 0; j < shapes.length; j++) {
   const from = shapes[i].map(n => n + 36 + root), to = shapes[j].map(n => n + 48 + (root + 5) % 12);
   const chord = { root: PITCH_CLASSES[(root + 5) % 12], quality };
   const previous = { version: 1 as const, chord: { root: PITCH_CLASSES[root], quality }, notes: from };
   const a = pairs(from, root, quality), b = pairs(to, (root + 5) % 12, quality);
   const guide = a.length && b.length ? Math.min(...a.flatMap(([w,x]) => b.map(([y,z]) => Math.min(Math.abs(w-y)+Math.abs(x-z),Math.abs(w-z)+Math.abs(x-y))))) : null;
   const result = describeCoordinatedPlacement(chord, to, 'rootless-a', 62, previous);
   expect(result.totalMovement).toBe(movement(from, to));
   expect(result.guideMotion).toBe(guide);
   expect(describeCoordinatedPlacement(chord,to,'quartal',62,previous).guideMotion).toBeNull();
  }
 }
});
