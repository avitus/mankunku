import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';
import { chordSymbol } from '$lib/music/chords';
import { fractionToFloat } from '$lib/music/intervals';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import type { Solo } from './types';
import { parseQuery, search } from './search';

/** Keep browser choices and names identical to the practice catalog. */
export const BROWSER_PROGRESSIONS = Object.values(PROGRESSION_TEMPLATES);

/** Search the catalog's chord sequence and its short/long change spacing. */
export function searchProgression(solos: Solo[], type: ChordProgressionType, options: {artist?: string; transpose?: boolean} = {}) {
 const template = PROGRESSION_TEMPLATES[type];
 const query = parseQuery(template.harmony.map(h=>chordSymbol(h.chord.root,h.chord.quality)).join(' '));
 return search(solos,query,options).filter(r=>r.chords.every((c,i)=>
  c.tick-r.notationStart === fractionToFloat(template.harmony[i].startOffset)*48
 ));
}
