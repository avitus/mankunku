// Diagnose-and-repair for the prod→dev lick copy (see copy-prod-licks-to-dev.md).
// Paste into the DEV tab's console (the tab where you view /licks).
// Prints which storage bucket the app reads and where lick data actually sits;
// if they differ, moves the lick key-set into the app's bucket and reloads.
(() => {
	const ROOT = 'mankunku:';
	const KEYS = [
		'user-licks', 'user-licks-owners', 'user-licks-meta',
		'community-adoptions', 'community-adopted-payloads',
		'community-adopted-authors', 'community-favorites',
		'user-lick-tags', 'lick-practice-progress', 'lick-unlock-count',
		'lick-tag-overrides', 'lick-category-overrides', 'lick-merge-meta',
		'lick-practice-sessions'
	];
	// Bucket the APP reads (mirrors namespace.ts getActiveUid):
	// auth-cookie uid -> __active pointer -> anon.
	const cookieUid = (() => {
		try {
			const chunks = [];
			for (const p of (document.cookie || '').split('; ')) {
				const eq = p.indexOf('=');
				if (eq < 0) continue;
				const m = p.slice(0, eq).match(/^sb-.*-auth-token(?:\.(\d+))?$/);
				if (!m) continue;
				chunks.push({
					idx: m[1] ? parseInt(m[1], 10) : -1,
					val: decodeURIComponent(p.slice(eq + 1))
				});
			}
			if (!chunks.length) return null;
			chunks.sort((a, b) => a.idx - b.idx);
			let raw = chunks.map((c) => c.val).join('');
			if (raw.startsWith('base64-')) {
				try { raw = atob(raw.slice(7)); } catch {}
			}
			const jwt = raw.match(/eyJ[\w-]+\.(eyJ[\w-]+)\.[\w-]+/);
			if (jwt) {
				const seg = jwt[1].replace(/-/g, '+').replace(/_/g, '/');
				const pad = '==='.slice((seg.length + 3) % 4);
				const payload = JSON.parse(atob(seg + pad));
				if (typeof payload?.sub === 'string' && payload.sub) return payload.sub;
			}
			return null;
		} catch {
			return null;
		}
	})();
	let pointer = 'anon';
	try {
		pointer = JSON.parse(localStorage.getItem(ROOT + '__active') ?? '"anon"') || 'anon';
	} catch {}
	const appUid = cookieUid ?? pointer;
	const appPrefix = appUid === 'anon' ? '' : 'u:' + appUid + ':';

	// Every bucket on this origin that holds a user-licks store.
	const buckets = new Map();
	for (let i = 0; i < localStorage.length; i++) {
		const full = localStorage.key(i);
		if (!full || !full.startsWith(ROOT)) continue;
		const m = full.slice(ROOT.length).match(/^(u:[^:]+:)?user-licks$/);
		if (!m) continue;
		let n = -1;
		try { n = JSON.parse(localStorage.getItem(full)).length; } catch {}
		buckets.set(m[1] ?? '', n);
	}

	console.log('origin: ' + location.origin);
	console.log(
		'app reads bucket: "' + appUid + '" (cookie uid: ' +
		(cookieUid ?? 'none') + ', __active: ' + JSON.stringify(pointer) + ')'
	);
	if (buckets.size === 0) {
		console.error(
			'No user-licks store in ANY bucket on this origin - ' +
			'the import never landed here. Re-run the import steps in THIS tab ' +
			'(mind localhost vs 127.0.0.1).'
		);
		return;
	}
	for (const [p, n] of buckets) {
		console.log('found user-licks in bucket "' + (p || 'anon') + '": ' + n + ' licks');
	}
	if (buckets.has(appPrefix)) {
		console.log(
			'Data is already in the bucket the app reads - hard-reload ' +
			'(Cmd+Shift+R). Still empty? Report this output back.'
		);
		return;
	}

	// Move the lick key-set from the fullest bucket into the app bucket.
	let srcPrefix = '';
	let best = -2;
	for (const [p, n] of buckets) {
		if (n > best) { best = n; srcPrefix = p; }
	}
	let copied = 0;
	for (const k of KEYS) {
		const v = localStorage.getItem(ROOT + srcPrefix + k);
		if (v !== null) {
			localStorage.setItem(ROOT + appPrefix + k, v);
			copied++;
		}
	}
	// Re-stamp owner ids to the active dev account so local cloud sync never
	// sees the production user id.
	if (appUid !== 'anon') {
		const raw = localStorage.getItem(ROOT + appPrefix + 'user-licks-owners');
		if (raw) {
			try {
				const owners = JSON.parse(raw);
				for (const id of Object.keys(owners)) owners[id] = appUid;
				localStorage.setItem(ROOT + appPrefix + 'user-licks-owners', JSON.stringify(owners));
			} catch {}
		}
	}
	console.log(
		'Moved ' + copied + ' stores from bucket "' + (srcPrefix || 'anon') +
		'" to bucket "' + appUid + '". Reloading...'
	);
	location.reload();
})();
