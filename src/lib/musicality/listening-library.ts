/** Detached local tune-book snapshots; storage and hydration remain owned by the app. */
export interface ListeningLibrarySnapshot {
 readonly tunes: readonly unknown[];
 readonly error: string | null;
}
export interface ListeningLibraryOptions {
 read(): unknown;
 whenHydrated(): Promise<void>;
 scope(): string;
 onChange(snapshot: ListeningLibrarySnapshot): void;
 onAccountChange(): void;
}
export function createListeningLibrary(options: ListeningLibraryOptions) {
 let request = 0;
 let disposed = false;
 let owner: string | null = null;
 const empty = () => options.onChange({ tunes: [], error: null });
 const publish = () => {
  let snapshot: ListeningLibrarySnapshot;
  try {
   const tunes = options.read();
   if (!Array.isArray(tunes)) throw new Error('Unreadable tune book');
   snapshot = { tunes: structuredClone(tunes), error: null };
  } catch {
   snapshot = { tunes: [], error: 'Your tune book could not be loaded. Open Tunes to check your saved charts.' };
  }
  options.onChange(snapshot);
 };
 return {
  refresh(accountKey: string): void {
   if (disposed) return;
   const current = ++request;
   const scope = options.scope();
   const nextOwner = JSON.stringify([accountKey, scope]);
   if (owner !== null && owner !== nextOwner) {
    empty();
    options.onAccountChange();
   }
   owner = nextOwner;
   publish();
   void options.whenHydrated().then(() => {
    if (disposed || current !== request) return;
    if (scope !== options.scope()) {
     empty();
     options.onAccountChange();
     return;
    }
    publish();
   });
  },
  dispose(): void { disposed = true; request++; }
 };
}
