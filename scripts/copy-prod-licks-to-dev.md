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
   Then paste the shared helper (below) once, followed by two steps, so
   the paste position can never produce a syntax error:
   1. Type `data = ` and paste the exported JSON straight after it, press
      enter (the object echoes back).
   2. Paste the import snippet below as-is, press enter. It writes the
      stores into the active bucket, re-stamps lick owner ids to the active
      dev account, and reloads.
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

## Shared helper — paste this FIRST in any console using these snippets

Resolves the bucket the app actually reads, exactly like
`src/lib/persistence/namespace.ts` (`getActiveUid`): auth-cookie uid first,
then the `__active` pointer, then anon. Using `__active` alone silently
targets the wrong bucket when a Supabase auth cookie is present (the bug that
made an import invisible on 2026-07-28).

```js
window.mankunkuActiveUid = () => {
	const ROOT = 'mankunku:';
	const cookieUid = (() => {
		try {
			const chunks = [];
			for (const p of (document.cookie || '').split('; ')) {
				const eq = p.indexOf('=');
				if (eq < 0) continue;
				const m = p.slice(0, eq).match(/^sb-.*-auth-token(?:\.(\d+))?$/);
				if (m) chunks.push({ idx: m[1] ? parseInt(m[1], 10) : -1, val: decodeURIComponent(p.slice(eq + 1)) });
			}
			if (!chunks.length) return null;
			chunks.sort((a, b) => a.idx - b.idx);
			let raw = chunks.map((c) => c.val).join('');
			if (raw.startsWith('base64-')) { try { raw = atob(raw.slice(7)); } catch {} }
			const jwt = raw.match(/eyJ[\w-]+\.(eyJ[\w-]+)\.[\w-]+/);
			if (jwt) {
				const seg = jwt[1].replace(/-/g, '+').replace(/_/g, '/');
				const payload = JSON.parse(atob(seg + '==='.slice((seg.length + 3) % 4)));
				if (typeof payload?.sub === 'string' && payload.sub) return payload.sub;
			}
			return null;
		} catch { return null; }
	})();
	let pointer = 'anon';
	try { pointer = JSON.parse(localStorage.getItem(ROOT + '__active') ?? '"anon"') || 'anon'; } catch {}
	return cookieUid ?? pointer;
};
```

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
	const active = mankunkuActiveUid();
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

## Import snippet (run on DEV at localhost:5173, AFTER `data = <paste>`)

```js
(() => {
	const ROOT = 'mankunku:';
	if (typeof data !== 'object' || data === null || !data['user-licks']) {
		console.error('No export found — do step 1 first (data = <paste JSON>).');
		return;
	}
	const active = mankunkuActiveUid();
	const prefix = active === 'anon' ? '' : 'u:' + active + ':';
	// Owner stamps carry the PRODUCTION user id; re-stamp to the active dev
	// account so cloud sync never treats the licks as someone else's.
	if (active !== 'anon' && data['user-licks-owners']) {
		const owners = JSON.parse(data['user-licks-owners']);
		for (const id of Object.keys(owners)) owners[id] = active;
		data['user-licks-owners'] = JSON.stringify(owners);
	}
	let n = 0;
	for (const [k, v] of Object.entries(data)) {
		localStorage.setItem(ROOT + prefix + k, v);
		n++;
	}
	const own = JSON.parse(data['user-licks']).length;
	console.log(`Imported ${n} stores (${own} own licks) into bucket "${active}". Reloading…`);
	location.reload();
})();
```

Notes:

- The import overwrites those stores in the dev bucket (fine on an empty dev
  profile; re-running refreshes them to the latest export).
- If you import while signed into a local dev account, the app's normal
  local-first sync will push the book up to the LOCAL Supabase stack on your
  next edits — dev cloud seeds itself; production is never touched.
- Recordings (IndexedDB) are not copied; they aren't needed by any lick or
  tune-practice feature.
