import { expect, it, vi } from 'vitest';
import { createListeningLibrary, type ListeningLibrarySnapshot } from '$lib/musicality/listening-library';

function fixture() {
 let resolve!: () => void;
 const hydration = new Promise<void>(done => { resolve = done; });
 let scope = 'anon:0';
 let rows: unknown = [{ id: 'local', title: 'Original chart', sections: [{ label: 'A' }] }];
 const changes: ListeningLibrarySnapshot[] = [];
 const changed = vi.fn();
 const read = vi.fn(() => rows);
 const library = createListeningLibrary({ read, whenHydrated: () => hydration, scope: () => scope,
  onChange: value => changes.push(value), onAccountChange: changed });
 return { library, changes, changed, read, resolve, setRows: (value: unknown) => rows = value,
  setScope: (value: string) => scope = value };
}

it('publishes detached local and hydrated snapshots without treating hydration as an account change', async () => {
 const f = fixture(); const source = [{ id: 'local', title: 'Original', sections: [{ label: 'A' }] }];
 f.setRows(source); f.library.refresh('anon');
 expect(f.changes.at(-1)?.tunes).toEqual(source);
 source[0].sections[0].label = 'Changed';
 expect((f.changes[0].tunes[0] as typeof source[0]).sections[0].label).toBe('A');
 f.resolve(); await Promise.resolve();
 expect((f.changes.at(-1)!.tunes[0] as typeof source[0]).sections[0].label).toBe('Changed');
 expect(f.changed).not.toHaveBeenCalled();
});

it('clears the old account before publishing its replacement and ignores stale hydration', async () => {
 const f = fixture(); f.library.refresh('anon');
 f.setScope('user-b:1'); f.setRows([{ id: 'new-account' }]); f.library.refresh('user-b');
 expect(f.changed).toHaveBeenCalledTimes(1);
 expect(f.changes.at(-2)).toEqual({ tunes: [], error: null });
 expect(f.changes.at(-1)?.tunes).toEqual([{ id: 'new-account' }]);
 f.resolve(); await Promise.resolve();
 expect(f.read).toHaveBeenCalledTimes(3);
 expect(f.changes.at(-1)?.tunes).toEqual([{ id: 'new-account' }]);
});

it('clears private snapshots if the active namespace changes while hydration is pending', async () => {
 const f = fixture(); f.library.refresh('anon'); f.setScope('other:1');
 f.resolve(); await Promise.resolve();
 expect(f.changed).toHaveBeenCalledTimes(1);
 expect(f.changes.at(-1)?.tunes).toEqual([]);
 expect(f.read).toHaveBeenCalledTimes(1);
});

it('reports unreadable storage without masquerading as an empty book', () => {
 const f = fixture(); f.setRows(null); f.library.refresh('anon');
 expect(f.changes.at(-1)).toEqual({ tunes: [], error: 'Your tune book could not be loaded. Open Tunes to check your saved charts.' });
 const changes: ListeningLibrarySnapshot[] = [];
 createListeningLibrary({ read: () => { throw new Error('malformed row'); }, whenHydrated: () => new Promise(() => {}), scope: () => 'anon',
  onChange: value => changes.push(value), onAccountChange: vi.fn() }).refresh('anon');
 expect(changes[0]).toEqual(f.changes.at(-1));
});

it('disposes pending hydration and never reopens a library after unmount', async () => {
 const f = fixture(); f.library.refresh('anon'); f.library.dispose();
 const before = f.changes.length; f.resolve(); await Promise.resolve(); f.library.refresh('anon');
 expect(f.changes).toHaveLength(before);
 expect(f.read).toHaveBeenCalledTimes(1);
});

it('refreshes the same account without resetting selection or its captured take', async () => {
 const f = fixture(); f.library.refresh('anon'); f.library.refresh('anon');
 f.resolve(); await Promise.resolve();
 expect(f.changed).not.toHaveBeenCalled();
 expect(f.read).toHaveBeenCalledTimes(3);
});
