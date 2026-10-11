/**
 * Replay the ear-training sharp/flat cue (`createTuningMonitor`) over every
 * saved production take → results/tuning_cue.md.
 *
 * Runs are cut at a key change or a 10-minute gap (Start resets the monitor;
 * the rows carry no run id). Each run's centre is the fader bank's
 * (`summarizeTuning`), so the table says how often the cue agrees with what
 * the player sees on pause. 2026-10-10: the per-take rule fired on 1 of 1943
 * takes; the window-pooled rule at 12 ¢ fires in 21 of the 23 runs centred
 * 10 ¢ or more and in no run centred under 5 ¢.
 *
 * The dump lives only on Andy's machine (`takes/prod/raw/session_results.json`,
 * gitignored); set PROD_ROWS to point elsewhere. Skips when it is absent.
 */
import { describe, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTuningMonitor, cleanTuningSamples } from '$lib/scoring/tuning';
import { summarizeTuning } from '$lib/scoring/tuning-summary';
import type { NoteResult } from '$lib/types/scoring';

const ROOT = join(process.cwd(), 'research/audio-scoring');
const ROWS = process.env.PROD_ROWS ?? join(ROOT, 'takes/prod/raw/session_results.json');
const RUN_GAP_MS = 10 * 60_000;

interface Row { key: string; timestamp: number; note_results: NoteResult[] }

/** Consecutive takes in one key with no 10-minute silence between them. */
function splitRuns(rows: Row[]): Row[][] {
	const runs: Row[][] = [];
	let run: Row[] = [];
	for (const row of rows) {
		const prev = run.at(-1);
		if (prev && (row.key !== prev.key || row.timestamp - prev.timestamp > RUN_GAP_MS)) { runs.push(run); run = []; }
		run.push(row);
	}
	if (run.length) runs.push(run);
	return runs;
}

describe('sharp/flat cue over production takes', () => {
	it.skipIf(!existsSync(ROWS))('writes results/tuning_cue.md', () => {
		let parsed = JSON.parse(readFileSync(ROWS, 'utf8'));
		if (!Array.isArray(parsed)) parsed = parsed.rows ?? parsed.result;
		const rows = (parsed as Row[])
			.filter(r => Array.isArray(r.note_results) && r.note_results.some(n => !n.extra))
			.sort((a, b) => a.timestamp - b.timestamp);
		const runs = splitRuns(rows);

		const buckets: Record<string, { runs: number; fired: number; share: number }> = {
			'under 5 ¢': { runs: 0, fired: 0, share: 0 }, '5 to 10 ¢': { runs: 0, fired: 0, share: 0 }, '10 ¢ and over': { runs: 0, fired: 0, share: 0 }
		};
		const sharpRuns: string[] = [];
		let takes = 0, fired = 0;
		for (const run of runs) {
			const monitor = createTuningMonitor();
			let samples: ReturnType<typeof cleanTuningSamples> = [];
			let on = 0;
			for (const row of run) {
				takes++;
				samples = [...samples, ...cleanTuningSamples(row.note_results)];
				if (monitor.record({ noteResults: row.note_results })) { on++; fired++; }
			}
			const summary = summarizeTuning(samples);
			if (summary.centre === null) continue;
			const size = Math.abs(summary.centre);
			const bucket = buckets[size < 5 ? 'under 5 ¢' : size < 10 ? '5 to 10 ¢' : '10 ¢ and over'];
			bucket.runs++; if (on) bucket.fired++; bucket.share += on / run.length;
			const steady = summary.notes.filter(n => n.steady);
			if (steady.length >= 5 && steady.every(n => Math.sign(n.median) === Math.sign(summary.centre!) && Math.abs(n.median) > 5)) {
				sharpRuns.push(`| ${new Date(run[0].timestamp).toISOString().slice(0, 10)} | ${run[0].key} | ${run.length} | ${summary.centre.toFixed(0)} | ${steady.length} | ${(100 * on / run.length).toFixed(0)}% |`);
			}
		}

		const lines = [
			'# Sharp/flat cue over production takes', '',
			`${takes} ear-training takes in ${runs.length} runs (a run ends at a key change or a 10-minute gap). The cue fired on ${fired} takes.`, '',
			'| Run centre (fader bank) | Runs | Runs where the cue fired | Mean share of takes with the cue on |', '|---|---|---|---|',
			...Object.entries(buckets).map(([k, b]) => `| ${k} | ${b.runs} | ${b.fired} | ${b.runs ? (100 * b.share / b.runs).toFixed(0) : 0}% |`), '',
			'## Runs where every steady fader (5 or more) sat on the same side, beyond 5 ¢', '',
			'| Date | Key | Takes | Centre ¢ | Steady notes | Takes with the cue on |', '|---|---|---|---|---|---|',
			...sharpRuns, ''
		];
		writeFileSync(join(ROOT, 'results/tuning_cue.md'), lines.join('\n'));
	});
});
