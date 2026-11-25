/** S3/S38/S39, B31–32. Complete an upper-voice echo on already budgeted chord attacks. */
import type { BassEvent, CompEvent, CoordinatedPianoVoicing } from './backing-generation';
import { harmonyAt, melodicSources, type HeardNote } from './backing-melodic-handoff';
import type { HarmonicSegment } from '$lib/types/music';
import { resolveCoordinatedVoicing, type CoordinatedVoicingMemory } from './coordinated-voicing';

export interface KeyboardMelodicAnswer {
 readonly source: readonly HeardNote[];
 readonly reply: readonly HeardNote[];
}

export function bassCall(events: readonly BassEvent[], native: boolean = false): HeardNote[] | undefined {
 if (events.length < (native ? 1 : 4) || events.length > 5 || events.some(e => e.melodicSource || e.rhythmAnswer) ||
     (!native && new Set(events.map(e => e.midi)).size < 3)) return;
 return events.map(({ absBeat, midi }) => ({ beat: absBeat, midi }));
}

export function validBassCalls(calls: readonly (readonly HeardNote[])[] | undefined, nextBar: number, native: boolean = false): boolean {
 return Array.isArray(calls) && calls.length <= 4 && calls.every((call, i) =>
  Array.isArray(call) && (call.length >= (native ? 1 : 4) && call.length <= 5) && call.every((note: HeardNote,j:number) =>
   note && Number.isFinite(note.beat) && note.beat >= (nextBar-4)*4 && note.beat >= 0 && note.beat < nextBar*4 &&
   Math.floor(note.beat/4) === Math.floor(call[0].beat/4) && (!j || note.beat > call[j-1].beat) &&
   Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127) &&
  (!i || call[0].beat > calls[i-1].at(-1)!.beat));
}

export function keyboardAnswerPrefix(source: readonly HeardNote[], keyboard: readonly HeardNote[], remaining: number, firstBeat: number, native: boolean = false): HeardNote[] | undefined {
 const length = source.length - remaining;
 if (length < (native ? 1 : 2) || remaining < 1 || remaining > (native ? 4 : 2) || keyboard.length < length) return;
 const prefix = keyboard.slice(-length);
 const gap = prefix[0].beat - source.at(-1)!.beat;
 if (gap <= 0 || gap > 4 || firstBeat - prefix.at(-1)!.beat > 4 || firstBeat <= prefix.at(-1)!.beat) return;
 for (let i = 1; i < length; i++) {
  const step = prefix[i].midi - prefix[i-1].midi;
  const original = source[i].midi - source[i-1].midi;
  if (Math.sign(step) !== Math.sign(original) || Math.abs(step-original) > 3 || prefix[i].beat-prefix[i-1].beat > 4) return;
 }
 return prefix;
}

interface KeyboardAnswerResult {
 events: CompEvent[];
 trace: CoordinatedPianoVoicing[];
 voicing: CoordinatedVoicingMemory;
}

export function finishKeyboardAnswer(input: {
 calls: readonly (readonly HeardNote[])[];
 keyboard: readonly HeardNote[];
 events: readonly CompEvent[];
 trace: readonly CoordinatedPianoVoicing[];
 harmony: readonly HarmonicSegment[];
 previous?: CoordinatedVoicingMemory;
 register: number;
 native?: boolean;
}): KeyboardAnswerResult | undefined {
 const { events, trace, harmony } = input;
 if (!input.previous || !events.length || events.length > (input.native ? 4 : 2) || events.length !== trace.length ||
     events.some((e,i) => e.barLineSustain || e.absBeat !== trace[i].absBeat || e.time !== trace[i].time ||
       trace[i].arrivalId || trace[i].decision.keyboardSuspension || trace[i].decision.chromaticInner ||
       trace[i].decision.fourthStack || trace[i].decision.spreadVoicing || trace[i].decision.upperStructure || trace[i].decision.keyboardColor)) return;
 // A phrase may begin on any bass attack, including a pickup across the barline.
 const heard = input.calls.flat();
 const sources = melodicSources(heard, input.native ? 2.5 : 1.5);
 for (const source of sources) {
  const prefix = keyboardAnswerPrefix(source, input.keyboard, events.length, events[0].absBeat, input.native);
  if (!prefix || prefix.at(-1)!.midi !== input.previous.notes.at(-1)) continue;
  const reply = [...prefix];
  let previous = input.previous;
  const voiced: CoordinatedPianoVoicing[] = [];
  for (const [i,event] of events.entries()) {
   const chord = harmonyAt(harmony,event.absBeat);
   const native = trace[i].decision;
   const anticipated = harmonyAt(harmony, event.absBeat + (event.absBeat % 1 ? .5 : 0));
   if (!chord || chord.root !== anticipated?.root || chord.quality !== anticipated.quality || chord.bass !== anticipated.bass) break;
   const index = reply.length;
   const anchor = reply[index-1].midi;
   const step = source[index].midi - source[index-1].midi;
   // A player may change inversion or voicing family to put a melody on top.
   // Keep the chord attack, voice count, register and harmonic movement bounded.
   const families = input.native && native.keyboardTexture ? [native.requestedFamily] : [native.requestedFamily, 'rootless-a', 'rootless-b', 'shell', 'drop2'] as const;
   const choices = [...new Set(families)].map(family => resolveCoordinatedVoicing({
    chord, previous, family, registerMidi: input.register, rootlessTexture: native.rootlessTexture?.request,
    spacing: native.spacing?.request, melodicStep: { anchor, step }
   })).filter(candidate => candidate.decision.melodicStep && candidate.notes.length === event.notes.length);
   const distance = (notes: readonly number[]) => Math.abs(notes.at(-1)! - anchor - step);
   choices.sort((a,b) => distance(a.notes) - distance(b.notes) || a.decision.totalMovement - b.decision.totalMovement);
   const result = choices[0];
   if (!result) break;
   const midi = result.notes.at(-1)!;
   voiced.push({ ...trace[i], notes: result.notes, decision: { ...result.decision,
    ...(native.keyboardTexture && { keyboardTexture: native.keyboardTexture }),
    ...(native.keyboardArticulation && { keyboardArticulation: native.keyboardArticulation }) } });
   reply.push({ midi, beat: event.absBeat });
   previous = result.memory;
  }
  if (reply.length !== source.length || new Set(reply.map(n=>n.midi)).size < 3 ||
      voiced.every((v,i) => v.notes.at(-1) === Math.max(...events[i].notes))) continue;
  const keyboardAnswer: KeyboardMelodicAnswer = { source, reply };
  return { events: events.map((e,i) => ({ ...e, notes: [...voiced[i].notes], keyboardAnswer })), trace: voiced, voicing: previous };
 }
}
