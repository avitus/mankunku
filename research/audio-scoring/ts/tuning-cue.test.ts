/**
 * Replay the ear-training sharp/flat cue (`createTuningMonitor`) over every
 * saved production take → results/tuning_cue.md.
 *
 * Runs are cut at a key change or a 10-minute gap (Start resets the monitor;
 * the rows carry no run id). Each run's centre is the fader bank's
 * (`summarizeTuning`), so the table says how often the cue agrees with what
 * the player sees on pause. 2026-10-20: hysteresis shipped (on 12, hold 8,
 * carry short takes), chosen from the variants in the second describe block. 2026-10-10: the per-take rule fired on 1 of 1943
 * takes; the window-pooled rule at 12 ¢ fires in 21 of the 23 runs centred
 * 10 ¢ or more and in no run centred under 5 ¢.
 *
 * The dump lives only on Andy's machine (`takes/prod/raw/session_results.json`,
 * gitignored); set PROD_ROWS to point elsewhere. Skips when it is absent.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTuningMonitor, cleanTuningSamples } from '$lib/scoring/tuning';
import { summarizeTuning } from '$lib/scoring/tuning-summary';
import type { NoteResult } from '$lib/types/scoring';
import { createVariantMonitor, type CueVariant } from './tuning-cue-variants';

const ROOT = join(process.cwd(), 'research/audio-scoring');
const ROWS = process.env.PROD_ROWS ?? join(ROOT, 'takes/prod/raw/session_results.json');
const RUN_GAP_MS = 10 * 60_000;

interface Row { key: string; timestamp: number; note_results: NoteResult[]; user_id?: string }

/** Consecutive takes in one key with no 10-minute silence between them. */
function splitRuns(rows: Row[]): Row[][] {
	const runs: Row[][] = [];
	let run: Row[] = [];
	for (const row of rows) {
		const prev = run.at(-1);
		if (prev && (row.key !== prev.key || row.user_id !== prev.user_id || row.timestamp - prev.timestamp > RUN_GAP_MS)) { runs.push(run); run = []; }
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
			`${takes} ear-training takes in ${runs.length} runs (a run ends at a key change, a user change or a 10-minute gap). The cue fired on ${fired} takes.`, '',
			'Rule replayed: the app\'s current `createTuningMonitor` — since 2026-10-20 on at a 12 ¢ window centre, held down to 8 ¢, and carried through takes with fewer than 2 clean notes. The variants it was chosen from, and the take-by-take trace of the 2026-10-15 run, are in tuning_cue_hysteresis.md. Under the 2026-10-10 rule (on and off at 12) on the same takes, runs centred 10 ¢ and over had the cue on for 27% of takes; the two under-5 runs that fire are a second player\'s flat-starting runs in C and fire under both rules.', '',
			'| Run centre (fader bank) | Runs | Runs where the cue fired | Mean share of takes with the cue on |', '|---|---|---|---|',
			...Object.entries(buckets).map(([k, b]) => `| ${k} | ${b.runs} | ${b.fired} | ${b.runs ? (100 * b.share / b.runs).toFixed(0) : 0}% |`), '',
			'## Runs where every steady fader (5 or more) sat on the same side, beyond 5 ¢', '',
			'| Date | Key | Takes | Centre ¢ | Steady notes | Takes with the cue on |', '|---|---|---|---|---|---|',
			...sharpRuns, ''
		];
		writeFileSync(join(ROOT, 'results/tuning_cue.md'), lines.join('\n'));
	});
});

const VARIANTS: CueVariant[] = [
	{ label: '2026-10-10 rule: enter 12, off at 12', enter: 12, hold: 12, carryShort: false },
	{ label: '2026-10-10 rule + carry short takes', enter: 12, hold: 12, carryShort: true },
	{ label: 'enter 12, hold 10', enter: 12, hold: 10, carryShort: false },
	{ label: 'enter 12, hold 10 + carry', enter: 12, hold: 10, carryShort: true },
	{ label: 'enter 12, hold 8', enter: 12, hold: 8, carryShort: false },
	{ label: 'enter 12, hold 8 + carry (SHIPPED 2026-10-20)', enter: 12, hold: 8, carryShort: true },
	{ label: 'hold 8 + carry + latest take need only lean ≥ 0 ¢ while on', enter: 12, hold: 8, carryShort: true, latestHold: 0 }
];
const BUCKETS = ['under 5 ¢', '5 to 10 ¢', '10 to 15 ¢', '15 ¢ and over'];
/** The run-centre bucket a fader-bank centre falls in, by size either way. */
const bucketOf = (c: number): string => { const a = Math.abs(c); return a < 5 ? BUCKETS[0] : a < 10 ? BUCKETS[1] : a < 15 ? BUCKETS[2] : BUCKETS[3]; };

describe('sharp/flat cue hysteresis variants', () => {
	it.skipIf(!existsSync(ROWS))('writes results/tuning_cue_hysteresis.md', () => {
		let parsed = JSON.parse(readFileSync(ROWS, 'utf8'));
		if (!Array.isArray(parsed)) parsed = parsed.rows ?? parsed.result;
		const rows = (parsed as Row[])
			.filter(r => Array.isArray(r.note_results) && r.note_results.some(n => !n.extra))
			.sort((a, b) => a.timestamp - b.timestamp);
		const runs = splitRuns(rows);
		const centred = runs.flatMap(run => {
			const c = summarizeTuning(run.flatMap(r => cleanTuningSamples(r.note_results))).centre;
			return c === null ? [] : [{ run, centre: c }];
		});
		const count: Record<string, number> = Object.fromEntries(BUCKETS.map(b => [b, 0]));
		const takeCount: Record<string, number> = Object.fromEntries(BUCKETS.map(b => [b, 0]));
		for (const { run, centre } of centred) { count[bucketOf(centre)]++; takeCount[bucketOf(centre)] += run.length; }

		const table: string[] = [];
		const flips: string[] = [];
		for (const v of VARIANTS) {
			const share: Record<string, number> = Object.fromEntries(BUCKETS.map(b => [b, 0]));
			const switches: Record<string, number> = Object.fromEntries(BUCKETS.map(b => [b, 0]));
			const fired: Record<string, number> = Object.fromEntries(BUCKETS.map(b => [b, 0]));
			for (const { run, centre } of centred) {
				const m = createVariantMonitor(v);
				const app = createTuningMonitor();
				let on = 0, sw = 0, prev = false;
				for (const row of run) {
					const got = m.record(row.note_results) !== null;
					// The shipped rule (2026-10-20): the app must match the variant take for take.
					if (v.enter === 12 && v.hold === 8 && v.carryShort && v.latestHold === undefined) {
						const want = app.record({ noteResults: row.note_results }) !== null;
						expect(got).toBe(want);
					}
					if (got) on++;
					if (got !== prev) sw++;
					prev = got;
				}
				const b = bucketOf(centre);
				share[b] += on / run.length; switches[b] += sw; if (on) fired[b]++;
			}
			table.push(`| ${v.label} | ${BUCKETS.map(b => `${count[b] ? (100 * share[b] / count[b]).toFixed(0) : 0}%`).join(' | ')} |`);
			flips.push(`| ${v.label} | ${BUCKETS.map(b => `${fired[b]}/${count[b]} · ${count[b] ? (switches[b] / count[b]).toFixed(1) : 0}`).join(' | ')} |`);
		}

		// Andy's 2026-10-15 F Lydian run, take by take.
		const target = centred.find(({ run }) => run[0].key === 'F' && run[0].timestamp >= 1792047600000 && run.length >= 40);
		const trace: string[] = [];
		if (target) {
			const ms = VARIANTS.map(v => createVariantMonitor(v));
			const appWindow = createVariantMonitor(VARIANTS[0]);
			target.run.forEach((row, i) => {
				const clean = cleanTuningSamples(row.note_results).length;
				const marks = ms.map(m => (m.record(row.note_results) !== null ? '●' : '·')).join(' ');
				appWindow.record(row.note_results);
				const c = appWindow.windowCentre();
				trace.push(`| ${i + 1} | ${clean} | ${c === null ? '–' : c.toFixed(1)} | ${marks} |`);
			});
		}

		const lines = [
			'# Sharp/flat cue: hysteresis variants', '',
			`${rows.length} ear-training takes, ${runs.length} runs (cut at a key change, a user change or a 10-minute gap), ${centred.length} with a fader-bank centre. Production dump through 2026-10-07 plus every ear-training row since, pulled read-only 2026-10-17.`, '',
			'Every variant keeps the other gates: the latest take must lean ≥ 5 ¢ the same way, a majority of takes lean, 80% of pitch classes lean, spread ≤ 10 ¢. "Hold" is the window centre the cue stays on at once on. "Carry" keeps the previous verdict through a take with fewer than 2 clean notes instead of clearing.', '',
			'## Mean per-take share of the cue being on, by run centre', '',
			`| Rule | ${BUCKETS.map(b => `${b} (${count[b]} runs, ${takeCount[b]} takes)`).join(' | ')} |`, `|---|${BUCKETS.map(() => '---').join('|')}|`,
			...table, '',
			'## Runs where the cue fired · mean on/off switches per run', '',
			`| Rule | ${BUCKETS.join(' | ')} |`, `|---|${BUCKETS.map(() => '---').join('|')}|`,
			...flips, '',
			...(target ? [
				`## The 2026-10-15 ${target.run[0].key} run (${target.run.length} takes, fader centre ${target.centre.toFixed(1)} ¢)`, '',
				`Columns in table order: ${VARIANTS.map(v => v.label).join('; ')}. Window centre is the 2026-10-10 rule's (– when a gate before it failed).`, '',
				'| Take | Clean notes | Window centre ¢ | Cue |', '|---|---|---|---|', ...trace, ''
			] : [])
		];
		writeFileSync(join(ROOT, 'results/tuning_cue_hysteresis.md'), lines.join('\n'));
	});
});
