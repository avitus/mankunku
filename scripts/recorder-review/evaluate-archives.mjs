// Evaluate the locked decoder on additional real performances. The score
// and exercise notes participate only in selection and post-hoc comparison.
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const freshKeys = args[0] === '--fresh-keys';
const [account, ...archives] = freshKeys ? args.slice(1) : args;
if (!account || !archives.length) throw new Error('Usage: node scripts/recorder-review/evaluate-archives.mjs [--fresh-keys] <account-uuid> <archive> [<archive> ...]');
const root = fileURLToPath(new URL('../../', import.meta.url));
const server = await createServer({
	root, configFile: false, resolve: { alias: { $lib: resolve(root, 'src/lib') } },
	// Keep SSR analysis away from the live dev server's optimized browser modules.
	cacheDir: resolve(root, 'node_modules/.vite-recorder-review'),
	optimizeDeps: { noDiscovery: true, entries: [] },
	server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom'
});
try {
	const { cases, corpus, replayTake, recorderComparisons } = await server.ssrLoadModule('/tests/helpers/recorder-baseline.ts');
	const fixedIds = new Set(cases.map(t => t.sessionId));
	const licks = new Set(cases.map(t => t.lickId));
	// Reject baseline melodies even if the new archive saved another ID or key.
	const shape = notes => notes.map(n => n.pitch - notes[0].pitch).join(',');
	const baselineShapes = new Set(cases.map(t => shape(t.expected)));
	const source = freshKeys ? 'ear-training' : 'lick-practice';
	const sessions = new Map();
	const bestByKey = new Map();
	for (const folder of archives) {
		for (const name of (await readdir(folder)).filter(name => name.endsWith('.json')).sort()) {
			const { context, recording, scoring } = JSON.parse(await readFile(resolve(folder, name), 'utf8'));
			if (context.source !== source || context.importedFrom !== 'firefox IndexedDB mankunku-audio:' + account) continue;
			const suffix = '_' + context.concertKey;
			const lickId = context.phraseId.endsWith(suffix) ? context.phraseId.slice(0, -suffix.length) : context.phraseId;
			const score = scoring.savedScore;
			if (!score || sessions.has(recording.sessionId)) continue;
			if (freshKeys ? licks.has(lickId) : !licks.has(lickId)) continue;
			const wav = resolve(folder, name.replace(/\.json$/, '.wav'));
			if (!(await stat(wav).catch(() => null))?.isFile()) continue;
			const expected = score.noteResults.filter(n => !n.extra).map(n => n.expected)
				.sort((a, b) => a.offset[0] / a.offset[1] - b.offset[0] / b.offset[1]);
			if (!expected.length || (freshKeys && baselineShapes.has(shape(expected)))) continue;
			const take = {
				lickId, sessionId: recording.sessionId, practiceScore: score.overall, recordedAt: recording.timestamp, sourceName: name,
				file: relative(fileURLToPath(corpus), wav), key: context.concertKey,
				instrumentId: context.instrument.id, tempo: context.tempo, expected
			};
			sessions.set(take.sessionId, take);
			if (freshKeys) continue;
			const key = lickId + suffix;
			const previous = bestByKey.get(key);
			const winsTie = previous && take.practiceScore === previous.practiceScore &&
				(take.recordedAt > previous.recordedAt ||
					take.recordedAt === previous.recordedAt && take.sourceName > previous.sourceName);
			if (!previous || take.practiceScore > previous.practiceScore || winsTie) bestByKey.set(key, take);
		}
	}
	const keyWinners = new Set([...bestByKey.values()].map(t => t.sessionId));
	const totals = new Map();
	const fresh = { takes: 0, licks: new Set([...sessions.values()].map(t => t.lickId)).size,
		keysBefore: 0, keysAfter: 0, gained: 0, lost: 0 };
	const { detectKey } = await server.ssrLoadModule('/src/lib/audio/quantizer.ts');
	for (const take of sessions.values()) {
		const transcript = await replayTake(take);
		if (freshKeys) {
			const before = !!transcript && detectKey(transcript.detected) === take.key;
			const after = transcript?.detectedKey === take.key;
			fresh.takes++;
			fresh.keysBefore += Number(before); fresh.keysAfter += Number(after);
			fresh.gained += Number(after && !before); fresh.lost += Number(before && !after);
			continue;
		}
		const result = recorderComparisons(take, transcript);
		const group = fixedIds.has(take.sessionId) ? 'Primary' : keyWinners.has(take.sessionId) ? 'Other key winners' : 'Unselected';
		const buckets = [group];
		if (group === 'Unselected' && take.practiceScore >= 0.90) buckets.push('Unselected, at least 90%');
		for (const bucket of buckets) {
			const row = totals.get(bucket) ?? { takes: 0, notes: 0, before: 0, after: 0, better: 0, equal: 0, worse: 0, readyBefore: 0, readyAfter: 0 };
			row.takes++; row.notes += take.expected.length;
			row.before += result.lastEdits.total; row.after += result.edits.total;
			row.readyBefore += Number(result.lastEdits.total === 0); row.readyAfter += Number(result.edits.total === 0);
			const delta = result.edits.total - result.lastEdits.total;
			if (delta < 0) row.better++; else if (delta === 0) row.equal++; else row.worse++;
			totals.set(bucket, row);
		}
	}
	console.table(freshKeys ? { independent: fresh } : Object.fromEntries(totals));
} finally {
	await server.close();
}
