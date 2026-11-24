/** S3.3–5, S38, S39: remember the spacing and stress of a played pair, then
 * let one other musician bring it out inside their own part. */
import type { BassEvent, CompEvent, DrumEvent } from './backing-generation';
import { createRng, seedFrom } from './generation-rng';

export type RhythmPlayer = 'bass' | 'piano' | 'drums';
export interface RhythmCell {
 readonly player: RhythmPlayer;
 readonly bar: number;
 readonly offsets: readonly [number, number];
 readonly stressed: 0 | 1;
}
export interface RhythmMemory {
 readonly cells: readonly RhythmCell[];
 readonly lastAnswer: Readonly<Partial<Record<RhythmPlayer, number>>>;
}
type Event = BassEvent | CompEvent | DrumEvent;
interface Parts { bass: BassEvent[]; piano: CompEvent[]; drums: DrumEvent[] }
const players = ['bass', 'piano', 'drums'] as const;
const pairGap = (a: Event, b: Event) => b.absBeat - a.absBeat;

function pairs(events: readonly Event[]): [Event, Event][] {
 const found: [Event, Event][] = [];
 for (let i = 0; i < events.length; i++) {
  for (const next of events.slice(i + 1)) {
   const gap = pairGap(events[i], next);
   if (gap >= .5 && gap <= 3 && Number.isInteger(gap * 2)) found.push([events[i], next]);
  }
 }
 return found;
}

function capture(player: RhythmPlayer, bar: number, parts: Parts): RhythmCell | undefined {
 // A walking or cymbal pulse alone is not a statement. Look for a leap,
 // a distinct chord rhythm, or a real kit comment, with a measurable stress.
 const scale = player === 'drums' ? 127 : 1;
 const material = player === 'drums' ? parts.drums.filter(e => e.role === 'commentary') : parts[player];
 const ordered = [...material].sort((a, b) => a.absBeat - b.absBeat);
 const attacks = ordered.filter((e, i) => i === 0 || ordered[i-1].absBeat !== e.absBeat);
 let best: RhythmCell | undefined;
 let contrast = 2;
 for (let i = 1; i < attacks.length; i++) {
  const first = attacks[i-1], last = attacks[i], gap = pairGap(first, last);
  if (gap < .5 || gap > 3 || !Number.isInteger(first.absBeat * 2) || !Number.isInteger(last.absBeat * 2)) continue;
  if ('midi' in first && 'midi' in last && Number.isInteger(gap) && Math.abs(first.midi-last.midi) < 4) continue;
  const difference = (last.velocity - first.velocity) * scale;
  if (Math.abs(difference) <= contrast) continue;
  contrast = Math.abs(difference);
  best = { player, bar, offsets: [first.absBeat-bar*4, last.absBeat-bar*4], stressed: difference > 0 ? 1 : 0 };
 }
 return best;
}

export function validRhythmMemory(memory: RhythmMemory | undefined, nextBar: number): boolean {
 if (!memory || !Array.isArray(memory.cells) || memory.cells.length > 48 || (!memory.lastAnswer || typeof memory.lastAnswer !== 'object' || Array.isArray(memory.lastAnswer))) return false;
 return memory.cells.every((c: RhythmCell) => c && players.includes(c.player) && Number.isSafeInteger(c.bar) &&
  c.bar >= Math.max(0, nextBar-16) && c.bar < nextBar && Array.isArray(c.offsets) && c.offsets.length === 2 &&
  c.offsets.every(n => Number.isInteger(n*2) && n >= 0 && n < 4) && c.offsets[1] > c.offsets[0] &&
  (c.stressed === 0 || c.stressed === 1)) &&
  Object.entries(memory.lastAnswer).every(([key, value]) => players.some(p => p === key) && Number.isSafeInteger(value) && value >= 0 && value < nextBar);
}

/** Reserve the existing response draw before another device alters the available attacks. */
export function rhythmAnswerOpportunity(seed: number, bar: number) {
 const rng = createRng(seedFrom(seed, bar, 'rhythmic-answer'));
 return rng.chance(.8) ? rng : undefined;
}

export function developRhythm(parts: Parts, previous: RhythmMemory | undefined, bar: number,
 eligible: boolean, canAnswer: boolean, seed: number): { parts: Parts; memory: RhythmMemory } {
 let cells = (previous?.cells ?? []).filter(cell => cell.bar >= bar-16);
 const lastAnswer = { ...previous?.lastAnswer };
 let speaker: RhythmPlayer | undefined;
 const rng = eligible && canAnswer && !Object.values(lastAnswer).includes(bar-1) ? rhythmAnswerOpportunity(seed, bar) : undefined;
 if (rng) {
  // First find playable quotations. The number of strokes in a ride pattern
  // must not give the drummer more votes than the pianist.
  const options = players.flatMap(player => {
   const notes = player === 'drums' ? parts.drums.filter(e => e.drum === 'ride' || e.drum === 'ride-bell' || e.drum === 'hihat' || e.role === 'commentary') : parts[player];
   const playable = pairs([...notes].sort((a,b) => a.absBeat-b.absBeat)).filter(([a,b]) =>
    (!('drum' in a && 'drum' in b) || a.drum === b.drum) && a.time !== b.time &&
    !('barLineSustain' in a || 'barLineSustain' in b));
   const matches = playable.flatMap(pair => cells.filter(c => c.player !== player && bar-c.bar >= 4 &&
    c.offsets[1]-c.offsets[0] === pairGap(...pair)).map(cell => ({ cell, pair })));
   const elapsed = bar - (lastAnswer[player] ?? -Infinity);
   return matches.length ? [{ value: { player, matches }, weight: elapsed <= 2 ? .35 : elapsed <= 4 ? .65 : 1 }] : [];
  });
  if (options.length) {
   const { player, matches } = rng.weighted(options);
   const { cell, pair } = rng.pick(matches);
   // Preserve the total pair velocity where possible. Give the two existing
   // strokes a clear strong–weak or weak–strong shape without shifting time.
   const mean = (pair[0].velocity + pair[1].velocity) / 2;
   const max = player === 'drums' ? 1 : 127;
   const delta = Math.min(max*.115, mean*.48, max-mean);
   const strong = mean + delta;
   // Already-shaped or saturated pairs do not spend a source or earn a card.
   if (delta > 0 && Math.abs(strong - pair[cell.stressed].velocity) >= max/127) {
    const shade = <T extends Event>(events: T[]): T[] => events.map(e => {
     const index = pair.indexOf(e);
     if (index < 0) return e;
     const velocity = index === cell.stressed ? strong : mean - delta;
     return { ...e, velocity: player === 'drums' ? velocity : Math.round(velocity), rhythmAnswer: cell };
    });
    parts = { ...parts, [player]: shade<Event>(parts[player]) };
    speaker = player;
    lastAnswer[player] = bar;
    cells = cells.filter(c => c !== cell);
   }
  }
 }
 // Expire after the final opportunity; an answer cannot seed its own echo.
 cells = cells.filter(cell => cell.bar > bar-16);
 if (eligible) for (const player of players) {
  if (player === speaker) continue;
  const cell = capture(player, bar, parts);
  if (cell) cells.push(cell);
 }
 return { parts, memory: { cells, lastAnswer } };
}

/** S38 short-term memory and S39 displacement. A whole-beat shift keeps the
 * original swing subdivision; an occupied keyboard attack rules out the pair. */
export function displacedRhythm(previous: RhythmMemory | undefined, bar: number,
 occupied: readonly number[], seed: number): { cell: RhythmCell; shift: number } | undefined {
 if (!previous || bar - (previous.lastAnswer.drums ?? -Infinity) <= 4 ||
     Object.values(previous.lastAnswer).includes(bar - 1)) return;
 const rng = createRng(seedFrom(seed, bar, 'displaced-rhythm'));
 const options = previous.cells.flatMap(cell => {
  const age = bar - cell.bar;
  if (cell.player === 'drums' || age < 1 || age > 2) return [];
  const weight = (age === 1 ? 2 : 1) * (cell.offsets.some(offset => !Number.isInteger(offset)) ? 2 : 1);
  const playable = [-1, 1].filter(shift => cell.offsets.every(offset => {
   const beat = offset + shift;
   return beat >= 0 && beat < 4 && !occupied.includes(beat);
  }));
  return playable.map(shift => ({ value: { cell, shift }, weight }));
 });
 if (options.length && rng.chance(.8)) return rng.weighted(options);
}
