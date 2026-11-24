/** S3, S38, S39 and B31–32. Sequence a recently played upper voice inside the walk. */
import type { BassEvent, CompEvent } from './backing-generation';

export interface HeardNote { readonly beat: number; readonly midi: number }
export interface MelodicMemory {
 readonly bassCalls?: readonly (readonly HeardNote[])[];
 readonly keyboard: readonly HeardNote[];
 readonly lastAnswerBar: number | null;
}
interface ChordWindow { readonly start: number; readonly length: number; readonly chordPcs: readonly number[] }

export function validMelodicMemory(memory: MelodicMemory | undefined, nextBar: number): boolean {
 return !!memory && Array.isArray(memory.keyboard) && memory.keyboard.length <= 5 &&
  (memory.lastAnswerBar === null || (Number.isSafeInteger(memory.lastAnswerBar) && memory.lastAnswerBar >= 0 && memory.lastAnswerBar < nextBar)) &&
  memory.keyboard.every((note, index, notes) => note && Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127 &&
   Number.isFinite(note.beat) && note.beat >= Math.max(0, nextBar - 3) * 4 && note.beat < nextBar * 4 &&
   (index === 0 || note.beat > notes[index-1].beat));
}

export function rememberKeyboard(previous: readonly HeardNote[], events: readonly CompEvent[], bar: number): HeardNote[] {
 const notes = previous.filter(note => note.beat >= (bar - 2) * 4);
 for (const event of events) {
  // A split sustain can repeat the same attack time. It is one sounding top note.
  const last = notes.at(-1);
  if (last?.beat === event.absBeat) notes[notes.length - 1] = { ...last, midi: Math.max(last.midi, ...event.notes) };
  else if (event.notes.length) notes.push({ beat: event.absBeat, midi: Math.max(...event.notes) });
 }
 return notes.slice(-5);
}

/** Fit the complete contour before changing a single attack. Keep downbeat, chord
 * arrivals and the last walking pulse, which prepares the following harmony. */
export function fitBassAnswer(source: readonly HeardNote[], walk: readonly BassEvent[], segments: readonly ChordWindow[]): number[] | undefined {
 const count = walk.length;
 if (count < 4 || count > 5 || source.length !== count || new Set(source.map(note => note.midi)).size < 3) return;
 const steps = source.slice(1).map((note, i) => note.midi - source[i].midi);
 const first = walk[0].absBeat;
 if (source.at(-1)!.beat >= first || source.at(-1)!.beat < first - 8 ||
     source.some((note,i) => i > 0 && note.beat - source[i-1].beat > 4)) return;
 const harmony = walk.map(event => segments.find(s => event.absBeat >= s.start && event.absBeat < s.start + s.length));
 const choices = walk.map((event, i) => {
  const chord = harmony[i];
  if (!chord) return [];
  if (i === 0 || chord !== harmony[i-1] || event.absBeat >= first + 3) {
   return chord.chordPcs.includes(event.midi % 12) ? [event.midi] : [];
  }
  return Array.from({ length: 28 }, (_, n) => n + 28).filter(midi => chord.chordPcs.includes(midi % 12) && Math.abs(midi - event.midi) <= 8);
 });
 let best: number[] | undefined;
 let bestCost = Infinity;
 function visit(pitches: number[], cost: number) {
  const i = pitches.length;
  if (cost >= bestCost) return;
  if (i === count) {
   if (new Set(pitches).size >= 3 && pitches.some((pitch,j) => pitch !== walk[j].midi)) { best = pitches; bestCost = cost; }
   return;
  }
  for (const pitch of choices[i]) {
   const step = i ? pitch - pitches[i-1] : 0;
   const error = i ? Math.abs(step - steps[i-1]) : 0;
   if (i && (Math.sign(step) !== Math.sign(steps[i-1]) || error > 3 || Math.abs(step) > 9)) continue;
   visit([...pitches, pitch], cost + 4 * error + Math.abs(pitch - walk[i].midi));
  }
 }
 visit([], 0);
 return best;
}
