/**
 * Shared setup and assertions for the musicality-listening-*.spec.ts files.
 *
 * These were one spec file until 2026-11-12. Smarter Testing splits the e2e
 * suite by FILE, so its 53 minutes of real-audio-clock tests (all three
 * browsers) always ran on one CI node and set the whole job to ~41 minutes.
 * Keep each listening spec small enough to balance; add a new file rather than
 * growing one.
 */
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test, expect } from './test';
import { seedOnboardedAnonymous } from './storage';
import { stubCdnInstrumentSamples } from './audio';
import { requireRealtimeAudio } from './realtime-audio';
import type { MusicianDecisionCard } from '../../../src/lib/musicality/musician-decisions';
import type { CausalListeningProvenance, ListeningSnapshot } from '../../../src/lib/musicality/listening-player';
import type { ListeningTuneBar } from '../../../src/lib/musicality/listening-tunes';

export interface ListeningEvidence {
	session: { tuneId: string; headBars: number; chorusBars: number; soloChoruses: number; bars: ListeningTuneBar[]; source?: unknown };
	completion: 'complete' | 'partial';
	playback: ListeningSnapshot;
	marks: { barIndex: number; elapsedBeats: number; note: string }[];
	decisions: MusicianDecisionCard[];
	review?: { barIndex: number; decisions: MusicianDecisionCard[] };
}

/**
 * The seed every take in this spec plays unless a test names another. The desk
 * draws a fresh energy seed on mount, and the seed decides which exchanges a
 * take contains: on the 0.16.1 engine the scalar bass continuation below
 * occurs under 209 of the first 300 seeds and the 180 BPM drum statement under
 * 16. Unpinned, each run auditioned a different take (main's first hosted run
 * of this spec failed 13 tests, 2026-11-12).
 */
export const TAKE_SEED = 2;

/** The desk's own pitch spelling (musician-decisions.ts `noteName`). */
export const noteName = (midi: number): string =>
	`${['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'][((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

export const TOP_NOTE_LINE = /Chord (\d) top-note target: ([A-G]♭?\d); actual top: ([A-G]♭?\d)/g;

/**
 * Wait until the piano card of the SOUNDING bar shows `pattern` at or after
 * `minBar`, and return that bar with the card's text, read in one page task.
 */
export async function awaitPianoEvidence(page: Page, pattern: RegExp, minBar: number, timeout: number): Promise<{ bar: number; text: string }> {
	const handle = await page.waitForFunction(([source, flags, minBar]) => {
		const row = document.querySelector('[data-testid="listening-position"]');
		const card = document.querySelector('[data-testid="musician-piano"]');
		const value = row?.getAttribute('data-bar-index');
		if (!card || value === null || value === undefined || value === '') return null;
		const bar = Number(value);
		if (bar < (minBar as number) || Number(card.getAttribute('data-bar-index')) !== bar) return null;
		const text = card.textContent ?? '';
		return new RegExp(source as string, flags as string).test(text) ? { bar, text } : null;
	}, [pattern.source, pattern.flags.replace('g', ''), minBar] as const, { timeout, polling: 40 });
	return handle.jsonValue() as Promise<{ bar: number; text: string }>;
}

/**
 * Every top-note line the card showed for `bar` must describe the chord the
 * take scheduled there: same chord number, same target, same sounding top.
 */
export function assertTopNoteLines(text: string, playback: ListeningSnapshot, bar: number): { chord: number; target: string; actual: string }[] {
	const generated = playback.generated!;
	const chords = generated.compEvents.filter(event => Math.floor(parseInt(event.time, 10) / playback.ppq / 4) === bar);
	const lines = [...text.matchAll(TOP_NOTE_LINE)].map(match => ({ chord: Number(match[1]), target: match[2], actual: match[3] }));
	expect(lines.length).toBeGreaterThan(0);
	for (const line of lines) {
		const event = chords[line.chord - 1];
		expect(event).toBeDefined();
		const trace = generated.ensembleDevelopment!.pianoVoicings!.find(entry => entry.time === event.time && entry.absBeat === event.absBeat)!;
		expect(trace.notes).toEqual(event.notes);
		const top = trace.decision.topLine!;
		expect(top.eligible).toBe(true);
		expect(top.actualMidi).toBe(Math.max(...event.notes));
		expect(top.distance).toBe(Math.abs(top.actualMidi - top.targetMidi));
		expect([noteName(top.targetMidi), noteName(top.actualMidi)]).toEqual([line.target, line.actual]);
	}
	return lines;
}

/** Observe real Web Audio dispatch without replacing its clock or the renderer. */
export async function observeAudio(page: Page, seed = TAKE_SEED): Promise<void> {
	await page.addInitScript((seed) => {
		// The desk's only single-word draw is its energy seed; everything else keeps real entropy.
		const random = crypto.getRandomValues.bind(crypto);
		crypto.getRandomValues = ((array: ArrayBufferView<ArrayBuffer>) => {
			if (array instanceof Uint32Array && array.length === 1) { array[0] = seed; return array; }
			return random(array);
		}) as typeof crypto.getRandomValues;
		const state = { contexts: [] as BaseAudioContext[], starts: 0, lastScheduledTime: 0, microphoneCalls: 0 };
		(window as unknown as { __listeningAudio: typeof state }).__listeningAudio = state;
		// WebKit may recreate navigator.mediaDevices; the prototype survives wrapper GC.
		MediaDevices.prototype.getUserMedia = async function () {
			state.microphoneCalls++;
			throw new Error('Listening must not request the microphone');
		};
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (!state.contexts.includes(this.context)) state.contexts.push(this.context);
			state.starts++;
			state.lastScheduledTime = Math.max(state.lastScheduledTime, args[0] ?? this.context.currentTime);
			return Reflect.apply(start, this, args);
		};
	}, seed);
}

export async function setup(page: Page, seed = TAKE_SEED): Promise<void> {
	await seedOnboardedAnonymous(page);
	await observeAudio(page, seed);
	await stubCdnInstrumentSamples(page);
	await page.goto('/musicality');
	await page.getByTestId('listening-tempo').fill('240');
}

export async function exportTake(page: Page): Promise<ListeningEvidence> {
	const notes = page.locator('details.take-notes');
	if (!(await notes.evaluate((element) => (element as HTMLDetailsElement).open))) await notes.locator('summary').click();
	const download = page.waitForEvent('download');
	await page.getByTestId('listening-export').click();
	const path = await (await download).path();
	expect(path).not.toBeNull();
	return JSON.parse(await readFile(path!, 'utf8')) as ListeningEvidence;
}

export function causalProvenance(playback: ListeningSnapshot): CausalListeningProvenance {
	expect(playback.provenance?.engine).toBe('causal-rolling');
	if (playback.provenance?.engine !== 'causal-rolling') throw new Error('Expected a causal take');
	return playback.provenance;
}

/** Every export contains only committed bars; an earlier downloaded score stays a prefix. */
export function assertCommittedPrefix(previous: ListeningSnapshot, current: ListeningSnapshot): void {
	expect(current.provenance?.engine).toBe('causal-rolling');
	expect(current.provenance!.committedBars).toBeGreaterThanOrEqual(previous.provenance!.committedBars);
	for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) {
		const prefix = previous.generated![field];
		expect(current.generated![field].slice(0, prefix.length)).toEqual(prefix);
	}
	expect(current.generated!.ensemblePlan!.bars.slice(0, previous.provenance!.committedBars))
		.toEqual(previous.generated!.ensemblePlan!.bars);
	expect(current.generated!.ensembleDevelopment!.pianoFeedback!.slice(0, previous.provenance!.committedBars))
		.toEqual(previous.generated!.ensembleDevelopment!.pianoFeedback);
}

export function assertActualFeedback(playback: ListeningSnapshot): void {
	const generated = playback.generated!;
	const feedback = generated.ensembleDevelopment!.pianoFeedback!;
	expect(feedback).toHaveLength(playback.provenance!.committedBars);
	for (const entry of feedback) {
		expect(entry.acceptedAttacks).toEqual(generated.compEvents.filter(event => Math.floor(event.absBeat! / 4) === entry.barIndex)
			.map(({ time, absBeat, notes }) => ({ time, absBeat, notes })));
		if (entry.source) {
			expect(entry.source.barIndex).toBe(entry.barIndex - 1);
			for (const hit of entry.source.hits) {
				expect(hit.role).toBe('commentary');
				// The sounding hit may carry an expression receipt the source copy omits.
				expect(generated.drumEvents).toContainEqual(expect.objectContaining(hit));
			}
		}
		if (entry.action === 'yield') {
			expect(entry.source!.hits.length).toBeGreaterThanOrEqual(2);
			// Since the accompaniment policy (engine 0.3, 2026-11-08) a yield thins
			// the bar's harmony instead of always emptying it.
			expect(entry.originalMaxAttacks).toBeGreaterThan(0);
			expect(entry.effectiveMaxAttacks).toBeLessThan(entry.originalMaxAttacks);
			expect(entry.acceptedAttacks.length).toBeLessThanOrEqual(entry.effectiveMaxAttacks);
		}
	}
}

export async function assertNoMicrophone(page: Page): Promise<void> {
	expect(await page.evaluate(() => (window as unknown as { __listeningAudio: { microphoneCalls: number } }).__listeningAudio.microphoneCalls)).toBe(0);
}

export async function soundingBar(page: Page): Promise<number> {
	const value = await page.getByTestId('listening-position').getAttribute('data-bar-index');
	return value === null || value === '' ? -1 : Number(value);
}

export async function sourceStarts(page: Page): Promise<number> {
	return page.evaluate(() => (window as unknown as { __listeningAudio: { starts: number } }).__listeningAudio.starts);
}

export async function playToBar(page: Page, bar = 1): Promise<void> {
	requireRealtimeAudio(page);
	await page.getByTestId('listening-play').click();
	await expect.poll(() => soundingBar(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(bar);
}

export async function assertDecisionClock(page: Page, score?: ListeningSnapshot, tempo = 240): Promise<void> {
	// Read all positions and the live clock atomically. A 150 ms allowance
	// covers the 40 ms UI poll; it does not allow scheduling lookahead to
	// advance the cards to a future bar.
	const position = await page.evaluate(() => {
		const row = document.querySelector('[data-testid="listening-position"]')!;
		const origin = Number(row.getAttribute('data-start-audio-time'));
		const bar = Number(row.getAttribute('data-bar-index'));
		const contexts = (window as unknown as { __listeningAudio: { contexts: BaseAudioContext[] } }).__listeningAudio.contexts;
		const arc = document.querySelector('[data-testid="listening-performance-arc"]');
		return { origin, bar, now: contexts.at(-1)?.currentTime,
			arc: arc ? { bar: Number(arc.getAttribute('data-bar-index')), phase: arc.getAttribute('data-phase') } : null,
			pianoEvidence: document.querySelector('[data-testid="musician-piano"]')?.textContent ?? '',
			cards: ['bass', 'piano', 'drums'].map((instrument) =>
				Number(document.querySelector(`[data-testid="musician-${instrument}"]`)?.getAttribute('data-bar-index'))),
			counts: ['bass', 'piano', 'drums'].map((instrument) => Number.parseInt(
				document.querySelector(`[data-testid="musician-${instrument}"] summary`)?.textContent ?? '', 10)) };
	});
	expect(position.origin).toBeGreaterThan(0);
	expect(position.now).toBeDefined();
	expect(position.cards).toEqual([position.bar, position.bar, position.bar]);
	const elapsed = position.now! - position.origin;
	const barSeconds = 240 / tempo;
	expect(elapsed).toBeGreaterThanOrEqual(position.bar * barSeconds);
	expect(elapsed).toBeLessThan((position.bar + 1) * barSeconds + 0.15);
	if (score?.generated) {
		const inBar = (event: { time: string }) => Math.floor(parseInt(event.time, 10) / score.ppq / 4) === position.bar;
		const plannedArc = score.generated.ensemblePlan?.bars[position.bar]?.performanceEnergy;
		expect(position.arc).toEqual(plannedArc ? { bar: position.bar, phase: plannedArc.phase } : null);
		const heardThree = score.generated.ensembleDevelopment?.pianoVoicings?.some(entry => inBar(entry) &&
			entry.decision.rootlessTexture?.applied === 'three' && entry.notes.length === 3) ?? false;
		expect(position.pianoEvidence.includes('texture: three-note rootless support')).toBe(heardThree);
		if (score.generated.ensemblePlan?.bars[position.bar]?.piano.rootlessTexture)
			expect(position.pianoEvidence).toContain('Planned rootless texture:');
		expect(position.counts).toEqual([score.generated.bassEvents, score.generated.compEvents, score.generated.drumEvents]
			.map((events) => events.filter(inBar).length));
	}
}
