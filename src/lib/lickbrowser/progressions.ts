import { PROGRESSION_TEMPLATES, progressionMode } from '$lib/data/progressions';
import { chordSymbol } from '$lib/music/chords';
import { fractionToFloat } from '$lib/music/intervals';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import type { Excerpt, Solo } from './types';
import { parseQuery, search } from './search';

/** Keep browser choices and names identical to the practice catalog. */
export const BROWSER_PROGRESSIONS = Object.values(PROGRESSION_TEMPLATES);

/**
 * Search the catalog's chord sequence and its short/long change spacing.
 * Templates are written in C and every result is moved into the query's key,
 * so each excerpt's tonic is C in the progression's mode.
 */
export function searchProgression(solos: Solo[], type: ChordProgressionType, options: {artist?: string; transpose?: boolean} = {}): Excerpt[] {
 const template = PROGRESSION_TEMPLATES[type];
 const query = parseQuery(template.harmony.map(h=>chordSymbol(h.chord.root,h.chord.quality)).join(' '));
 const mode = progressionMode(type);
 return search(solos,query,options).filter(r=>r.chords.every((c,i)=>
  c.tick-r.notationStart === fractionToFloat(template.harmony[i].startOffset)*48
 )).map((r): Excerpt => ({...r, tonic: 0, mode}));
}
