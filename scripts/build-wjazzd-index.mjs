#!/usr/bin/env node
/**
 * Preprocess the Weimar Jazz Database into the compact JSON index that
 * /api/lick-match loads at startup.
 *
 * Prerequisites (run once, then discard):
 *   1. Download wjazzd.db from https://jazzomat.hfm-weimar.de/dbformat/dbdownload.html
 *   2. Place it at  data/raw/wjazzd.db  (gitignored — do not commit the raw DB)
 *   3. Install the sqlite driver ephemerally:  npm i --no-save better-sqlite3
 *   4. Run:  node scripts/build-wjazzd-index.mjs
 *
 * Output: src/lib/matching/data/wjazzd-index.json  (commit this)
 *
 * The Weimar Jazz Database is licensed CC-BY-NC-SA 4.0. See
 * docs/wjazzd-attribution.md for required attribution text and license
 * obligations. Do not distribute Mankunku commercially with this index
 * bundled without confirming NC-compatibility.
 */
import { writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DB_PATH = resolve(REPO_ROOT, 'data/raw/wjazzd.db');
const OUT_PATH = resolve(REPO_ROOT, 'src/lib/matching/data/wjazzd-index.json');

if (!existsSync(DB_PATH)) {
	console.error(`[build-wjazzd-index] Missing DB at ${DB_PATH}`);
	console.error('See the header of this script for setup steps.');
	process.exit(1);
}

let Database;
try {
	Database = (await import('better-sqlite3')).default;
} catch {
	console.error('[build-wjazzd-index] better-sqlite3 is not installed.');
	console.error('Run: npm i --no-save better-sqlite3');
	process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

// solo_info metadata — column names match the Jazzomat WJazzD schema.
// See https://jazzomat.hfm-weimar.de/dbformat/dbcontent.html
// recording year is on record_info (the label/release row) not solo_info.
const solos = db.prepare(`
	SELECT
		s.melid       AS melid,
		s.performer   AS performer,
		s.title       AS title,
		s.titleaddon  AS titleaddon,
		s.key         AS key,
		s.avgtempo    AS avgtempo,
		r.releasedate AS releasedate
	FROM solo_info s
	LEFT JOIN record_info r ON r.recordid = s.recordid
`).all();

const melodyStmt = db.prepare(`
	SELECT pitch, onset, bar
	FROM melody
	WHERE melid = ?
	ORDER BY onset ASC
`);

const MIN_NOTES = 6; // need at least 5 intervals to contribute a 5-gram
const sources = [];
const phrases = [];

for (const solo of solos) {
	const events = melodyStmt.all(solo.melid);
	if (events.length < MIN_NOTES) continue;

	const sourceId = `wjazzd:${solo.melid}`;
	const yearMatch = typeof solo.releasedate === 'string' ? solo.releasedate.match(/\d{4}/) : null;
	const year = yearMatch ? Number(yearMatch[0]) : undefined;
	sources.push({
		id: sourceId,
		kind: 'wjazzd',
		performer: solo.performer ?? 'Unknown',
		title: [solo.title, solo.titleaddon].filter(Boolean).join(' — ') || 'Untitled',
		key: solo.key ?? undefined,
		year
	});

	// Per-solo IOI normalization: use the solo's avg tempo to convert onset
	// deltas (seconds) into 16th-note ticks. Falls back to 120 BPM if missing.
	const bpm = solo.avgtempo && solo.avgtempo > 0 ? solo.avgtempo : 120;
	const secPerSixteenth = 60 / bpm / 4;

	const intervals = [];
	const iois = [];
	for (let i = 1; i < events.length; i++) {
		intervals.push(events[i].pitch - events[i - 1].pitch);
		const deltaSec = events[i].onset - events[i - 1].onset;
		iois.push(Math.max(1, Math.round(deltaSec / secPerSixteenth)));
	}

	phrases.push({
		sourceId,
		startBar: events[0].bar ?? 1,
		intervals,
		iois
	});
}

db.close();

const bundle = {
	_readme: `Built ${new Date().toISOString()} from WJazzD. ${sources.length} solos, ${phrases.length} phrases. CC-BY-NC-SA 4.0 — see docs/wjazzd-attribution.md.`,
	sources,
	phrases
};

// Compact JSON keeps the committed file small. The endpoint parses it once
// at startup, so readability in-repo is not a priority.
writeFileSync(OUT_PATH, JSON.stringify(bundle));

const bytes = JSON.stringify(bundle).length;
console.log(`[build-wjazzd-index] Wrote ${sources.length} sources / ${phrases.length} phrases`);
console.log(`[build-wjazzd-index] Output: ${OUT_PATH} (~${(bytes / 1024).toFixed(0)} KB uncompressed)`);
