/** S3/S38/S39, B31–32. Complete a heard contour inside the native bass pattern. */
import type { HarmonicSegment } from '$lib/types/music';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { pitchClassToNumber } from './voicings';
import type { BassEvent } from './backing-generation';
import { fitContour, harmonyAt, melodicSources, type HeardNote } from './backing-melodic-handoff';

function sameChord(a: HarmonicSegment['chord'] | undefined, b: HarmonicSegment['chord'] | undefined): boolean {
 return !!a && !!b && a.root === b.root && a.quality === b.quality && a.bass === b.bass;
}

export function finishNativeBassAnswer(style: 'ballad' | 'bossa-nova', keyboard: readonly HeardNote[],
 priorBass: readonly HeardNote[], events: readonly BassEvent[], harmony: readonly HarmonicSegment[]): { reply: HeardNote[]; events: BassEvent[] } | undefined {
 if (!events.length || events.some(e => e.bossaOctavePickup || e.balladThird || e.balladHeldBass || e.rhythmAnswer)) return;
 const candidates = events.map(event => {
  const beat = event.absBeat;
  const offset = beat % 4;
  const movable = style === 'ballad' ? offset === 2 : offset === 1.5 || offset === 3.5;
  const chord = harmonyAt(harmony, beat);
  if (!chord) return [];
  if (!movable || !sameChord(chord, harmonyAt(harmony, beat - .5)) ||
      !sameChord(chord, harmonyAt(harmony, beat + .5))) return [event.midi];
  const root = pitchClassToNumber(chord.root);
  const pcs = CHORD_DEFINITIONS[chord.quality].intervals.map(interval => (root + interval) % 12);
  return Array.from({length: 28}, (_, i) => i + 28).filter(pitch => pcs.includes(pitch % 12) && Math.abs(pitch-event.midi) <= 9);
 });
 if (!candidates.some((pitches,i) => pitches.some(pitch => pitch !== events[i].midi))) return;
 const attacks = [...priorBass, ...events.map(e => ({ beat: e.absBeat, midi: e.midi }))];
 for (const source of melodicSources(keyboard, 4)) {
  for (let end = attacks.length; end > priorBass.length && end >= source.length; end--) {
   const start = end - source.length;
   const phrase = attacks.slice(start, end);
   const gap = phrase[0].beat - source.at(-1)!.beat;
   if (gap <= 0 || gap > 4 || phrase.some((n,i) => i && n.beat - phrase[i-1].beat > 2.5)) continue;
   const ordinary = phrase.map(n => n.midi);
   const choices = phrase.map((n,i) => start+i < priorBass.length ? [n.midi] : candidates[start+i-priorBass.length]);
   const pitches = fitContour(source, ordinary, choices);
   if (!pitches) continue;
   const reply = phrase.map((n,i) => ({ ...n, midi: pitches[i] }));
   return { reply, events: events.map((e,i) => {
    const index = priorBass.length + i - start;
    return index >= 0 && index < reply.length ? { ...e, midi: pitches[index], melodicSource: source, melodicReply: reply } : e;
   }) };
  }
 }
}
