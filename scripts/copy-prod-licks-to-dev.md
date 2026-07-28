# Copy your licks from production into the dev environment

The app is local-first: your whole lick book (own licks, adopted community
licks, `prog:*` tags, per-key practice progress, unlock counts, overrides,
session log) lives in namespaced localStorage on whichever origin you use,
hydrated from cloud on load. So the safest prod → dev copy is browser-to-
browser via two console snippets — **read-only on production**, no database
access, no service keys.

Storage layout (see `src/lib/persistence/namespace.ts`): keys are
`mankunku:u:<uid>:<key>` when signed in, bare `mankunku:<key>` when anonymous,
with the active bucket named by the `mankunku:__active` pointer. Both snippets
resolve the active bucket the same way the app does, so they work signed-in or
anonymous on either side.

## Steps

1. **Export (production).** Open the production site in a tab where you are
   signed in and your licks are visible (that guarantees the cache is
   hydrated). Open the devtools console, paste the export snippet, press
   enter. It prints how many licks it found and puts the JSON on your
   clipboard. If it reports 0 own licks, stop — the active bucket didn't
   match; reload the page and retry.
2. **Import (dev).** Open the dev site (http://localhost:5173). Decide the
   target first:
   - Testing anonymously (recommended — tune practice needs no account):
     just stay signed out.
   - Want it under a local dev account: sign into that account **first**,
     then import (it lands directly in that user's bucket).
   Paste the import snippet into the console, then paste the copied JSON
   between the final parentheses where `PASTE_EXPORTED_JSON_HERE` is, press
   enter. It writes the stores into the active bucket and reloads.
3. Verify: `/licks` shows your book, and a tune's Practice-licks setup screen
   now names your licks at the insertion points.

Anon-bucket caveat: if you import while anonymous and later sign into a dev
account, the anon-adoption trust rule (`namespace.ts`) only carries the data
across if this tab authored an anon write first — make any small change (e.g.
toggle a practice tag) before signing in, or simply re-run the import while
signed in.

Set `INCLUDE_TUNES = true` in the export snippet to also bring your own and
adopted tunes across — useful for testing tune practice against your real
charts rather than only the curated three.

## Export snippet (run on PRODUCTION — read-only)

```js
(() => {
	const ROOT = 'mankunku:';
	const INCLUDE_TUNES = false; // true = also copy your tunes
	const LICK_KEYS = [
		'user-licks', 'user-licks-owners', 'user-licks-meta',
		'community-adoptions', 'community-adopted-payloads', 'community-adopted-authors',
		'community-favorites',
		'user-lick-tags', 'lick-practice-progress', 'lick-unlock-count',
		'lick-tag-overrides', 'lick-category-overrides', 'lick-merge-meta',
		'lick-practice-sessions'
	];
	const TUNE_KEYS = [
		'user-tunes', 'user-tunes-owners', 'user-tunes-meta',
		'tune-adoptions', 'tune-adopted-payloads', 'tune-adopted-authors', 'tune-favorites'
	];
	const keys = INCLUDE_TUNES ? [...LICK_KEYS, ...TUNE_KEYS] : LICK_KEYS;
	const active = JSON.parse(localStorage.getItem(ROOT + '__active') ?? '"anon"');
	const prefix = active === 'anon' ? '' : 'u:' + active + ':';
	const out = {};
	for (const k of keys) {
		const v = localStorage.getItem(ROOT + prefix + k);
		if (v !== null) out[k] = v;
	}
	const own = JSON.parse(out['user-licks'] ?? '[]').length;
	const adopted = JSON.parse(out['community-adopted-payloads'] ?? '[]').length;
	console.log(`Exported ${Object.keys(out).length} stores from bucket "${active}": ` +
		`${own} own licks, ${adopted} adopted.`);
	const payload = JSON.stringify(out);
	try { copy(payload); console.log('→ JSON copied to clipboard.'); }
	catch { console.log('→ copy() unavailable — copy the next log line manually:'); console.log(payload); }
})();
```

## Import snippet (run on DEV at localhost:5173)

```js
((data) => {
	const ROOT = 'mankunku:';
	const active = JSON.parse(localStorage.getItem(ROOT + '__active') ?? '"anon"');
	const prefix = active === 'anon' ? '' : 'u:' + active + ':';
	for (const [k, v] of Object.entries(data)) localStorage.setItem(ROOT + prefix + k, v);
	console.log(`Imported ${Object.keys(data).length} stores into bucket "${active}". Reloading…`);
	location.reload();
})(PASTE_EXPORTED_JSON_HERE);
```

Notes:

- The import overwrites those stores in the dev bucket (fine on an empty dev
  profile; re-running refreshes them to the latest export).
- If you import while signed into a local dev account, the app's normal
  local-first sync will push the book up to the LOCAL Supabase stack on your
  next edits — dev cloud seeds itself; production is never touched.
- Recordings (IndexedDB) are not copied; they aren't needed by any lick or
  tune-practice feature.
