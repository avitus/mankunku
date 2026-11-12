/** Device-local rollback choice; independent of cloud settings and instrument mix. */
export type BackingArrangementPreference = 'coordinated' | 'original';
const key = 'backing-arrangement-v1';
let sessionChoice: BackingArrangementPreference | undefined;
export function getBackingArrangementPreference(): BackingArrangementPreference {
 if (sessionChoice) return sessionChoice;
 try { return globalThis.localStorage?.getItem(key) === 'original' ? 'original' : 'coordinated'; }
 catch { return 'coordinated'; }
}
export function setBackingArrangementPreference(value: BackingArrangementPreference): void {
 sessionChoice = value === 'original' ? 'original' : 'coordinated';
 try { globalThis.localStorage?.setItem(key, sessionChoice); } catch { /* Still usable for this page session. */ }
}
