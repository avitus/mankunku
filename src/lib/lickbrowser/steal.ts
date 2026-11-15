import type { Phrase } from '$lib/types/music';
import type { Excerpt } from './types';
import { getUserLicksLocal, saveUserLick } from '$lib/persistence/user-licks';
import { seedStolenLickPracticeDefaults } from '$lib/persistence/lick-practice-store';

/** Identify the source window independently of key, instrument and user-copy ID. */
export function excerptReference(excerpt: Pick<Excerpt, 'id' | 'notationEnd'>): string {
 return `wjazzd:${excerpt.id}:${excerpt.notationEnd}`;
}

/** Copy a Weimar score to the personal book without overwriting an existing edit. */
export function stealExcerpt(score: Phrase, excerpt: Excerpt): Phrase {
 const reference=excerptReference(excerpt);
 const existing=getUserLicksLocal().find(lick=>lick.tags.includes(reference));
 if(existing)return existing;
 const saved=saveUserLick({
  ...score,
  // Personal copies need independent IDs: user_licks has a global primary key.
  id:'',
  name:`${score.name} · WJD ${excerpt.id}`,
  tags:[...new Set([...score.tags,reference])],
  source:`Weimar Jazz Database (Jazzomat), solo ${excerpt.sourceId}, excerpt ${excerpt.id}; ODbL 1.0 / DbCL 1.0`
 });
 // Storage saves can fail silently (for example a full browser quota).
 if(!getUserLicksLocal().some(lick=>lick.id===saved.id))throw new Error('The lick could not be saved on this device. Please free browser storage and try again.');
 seedStolenLickPracticeDefaults(saved);
 return saved;
}
